import {
  type BaseItemDto,
  type MediaSourceInfo,
  PlaybackOrder,
  PlaybackProgressInfo,
  RepeatMode,
} from "@jellyfin/sdk/lib/generated-client";
import {
  getPlaystateApi,
  getUserLibraryApi,
} from "@jellyfin/sdk/lib/utils/api";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  AppState,
  Platform,
  useWindowDimensions,
  View,
} from "react-native";
import { useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { BITRATES } from "@/components/BitrateSelector";
import { Text } from "@/components/common/Text";
import { Loader } from "@/components/Loader";
import { Controls } from "@/components/video-player/controls/Controls";
import { PlayerProvider } from "@/components/video-player/controls/contexts/PlayerContext";
import { VideoProvider } from "@/components/video-player/controls/contexts/VideoContext";
import { SyncPlayModal } from "@/components/video-player/controls/SyncPlayModal";
import {
  PlaybackSpeedScope,
  updatePlaybackSpeedSettings,
} from "@/components/video-player/controls/utils/playback-speed-settings";
import useRouter from "@/hooks/useAppRouter";
import { useHaptic } from "@/hooks/useHaptic";
import { useOrientation } from "@/hooks/useOrientation";
import { usePlaybackManager } from "@/hooks/usePlaybackManager";
import usePlaybackSpeed from "@/hooks/usePlaybackSpeed";
import { useInvalidatePlaybackProgressCache } from "@/hooks/useRevalidatePlaybackProgressCache";
import { useSyncPlay } from "@/hooks/useSyncPlay";
import { useWebSocket } from "@/hooks/useWebsockets";
import {
  type MpvOnErrorEventPayload,
  type MpvOnPlaybackStateChangePayload,
  type MpvOnProgressEventPayload,
  MpvPlayerView,
  type MpvPlayerViewRef,
  type MpvVideoSource,
} from "@/modules";
import { useDownload } from "@/providers/DownloadProvider";
import { DownloadedItem } from "@/providers/Downloads/types";
import { apiAtom, userAtom } from "@/providers/JellyfinProvider";
import { OfflineModeProvider } from "@/providers/OfflineModeProvider";
import { useWebSocketContext } from "@/providers/WebSocketProvider";
import {
  syncPlayBuffering,
  syncPlayPause,
  syncPlayPlay,
  syncPlayReady,
  syncPlaySeek,
} from "@/services/SyncPlayService";

import { useSettings } from "@/utils/atoms/settings";
import { getPrimaryImageUrl } from "@/utils/jellyfin/image/getPrimaryImageUrl";
import { getStreamUrl } from "@/utils/jellyfin/media/getStreamUrl";
import {
  getMpvAudioId,
  getMpvSubtitleId,
} from "@/utils/jellyfin/subtitleUtils";
import { writeToLog } from "@/utils/log";
import { generateDeviceProfile } from "@/utils/profiles/native";
import { msToTicks, ticksToMs, ticksToSeconds } from "@/utils/time";

const SYNC_PLAY_DRIFT_CHECK_INTERVAL_MS = 1500;
const SYNC_PLAY_RESYNC_COOLDOWN_MS = 1500;
const SYNC_PLAY_QUEUE_PLAYBACK_STATE_MAX_AGE_MS = 5000;

// SpeedToSync: smooth catch-up via playback rate adjustment for small drifts.
const SYNC_PLAY_MIN_DRIFT_SPEED_SYNC_MS = 200;
const SYNC_PLAY_MAX_DRIFT_SPEED_SYNC_MS = 2500;
const SYNC_PLAY_SPEED_SYNC_DURATION_MS = 1000;
const SYNC_PLAY_MIN_SPEED_CLAMP = 0.2;

// SkipToSync: hard seek for large drifts.
const SYNC_PLAY_MIN_DRIFT_SKIP_SYNC_MS = 400;

// Buffering debounce: don't notify server of brief stalls.
const SYNC_PLAY_BUFFERING_DEBOUNCE_MS = 1500;

// Safety net: always-on large-drift catch (even with sync correction off).
// Catches catastrophic desync from backgrounding, missed commands, etc.
const SYNC_PLAY_SAFETY_NET_DRIFT_MS = 5000;
const SYNC_PLAY_SAFETY_NET_CHECK_INTERVAL_MS = 3000;

export default function page() {
  const videoRef = useRef<MpvPlayerViewRef>(null);
  const user = useAtomValue(userAtom);
  const api = useAtomValue(apiAtom);
  const {
    isInSyncPlayGroup,
    isConnected,
    syncPlayPlaylistItemId,
    syncPlayCurrentPositionCapturedAtMs,
  } = useWebSocketContext();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const router = useRouter();
  const { settings, updateSettings } = useSettings();

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [isPlaybackStopped, setIsPlaybackStopped] = useState(false);
  const [showControls, _setShowControls] = useState(true);
  const [isPipMode, setIsPipMode] = useState(false);
  const [aspectRatio] = useState<"default" | "16:9" | "4:3" | "1:1" | "21:9">(
    "default",
  );
  const [isZoomedToFill, setIsZoomedToFill] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [tracksReady, setTracksReady] = useState(false);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [currentPlaybackSpeed, setCurrentPlaybackSpeed] = useState(1.0);
  const [showTechnicalInfo, setShowTechnicalInfo] = useState(false);
  const [showSyncPlayModal, setShowSyncPlayModal] = useState(false);
  const lastReportedSyncPlayBufferingRef = useRef<boolean | null>(null);
  const isPlayingRef = useRef(false);
  const reportSyncPlayPauseRef = useRef<(() => Promise<void>) | undefined>(
    undefined,
  );
  const lastSyncPlaySeekAtRef = useRef(0);
  const lastLocalPlayPauseCommandAtRef = useRef(0);
  const lastDriftCorrectionAtRef = useRef(0);
  const speedSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSpeedSyncingRef = useRef(false);
  const bufferingDebounceTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const queueUpdateObservedAtRef = useRef(0);
  const wasSocketConnectedRef = useRef(isConnected);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const progress = useSharedValue(0);
  const isSeeking = useSharedValue(false);
  const cacheProgress = useSharedValue(0);
  const VolumeManager = Platform.isTV
    ? null
    : require("react-native-volume-manager");

  const downloadUtils = useDownload();
  // Call directly instead of useMemo - the function reference doesn't change
  // when data updates, only when the provider initializes
  const downloadedFiles = downloadUtils.getDownloadedItems();

  const revalidateProgressCache = useInvalidatePlaybackProgressCache();

  const lightHapticFeedback = useHaptic("light");

  const setShowControls = useCallback((show: boolean) => {
    _setShowControls(show);
    lightHapticFeedback();
  }, []);

  const {
    itemId,
    audioIndex: audioIndexStr,
    subtitleIndex: subtitleIndexStr,
    mediaSourceId,
    bitrateValue: bitrateValueStr,
    offline: offlineStr,
    playbackPosition: playbackPositionFromUrl,
  } = useLocalSearchParams<{
    itemId: string;
    audioIndex: string;
    subtitleIndex: string;
    mediaSourceId: string;
    bitrateValue: string;
    offline: string;
    /** Playback position in ticks. */
    playbackPosition?: string;
  }>();
  const { lockOrientation, unlockOrientation } = useOrientation();

  const offline = offlineStr === "true";
  const playbackManager = usePlaybackManager({ isOffline: offline });

  // Audio index: use URL param if provided, otherwise use stored index for offline playback
  // This is computed after downloadedItem is available, see audioIndexResolved below
  const audioIndexFromUrl = audioIndexStr
    ? Number.parseInt(audioIndexStr, 10)
    : undefined;
  const subtitleIndex = subtitleIndexStr
    ? Number.parseInt(subtitleIndexStr, 10)
    : -1;
  const bitrateValue = bitrateValueStr
    ? Number.parseInt(bitrateValueStr, 10)
    : BITRATES[0].value;

  const [item, setItem] = useState<BaseItemDto | null>(null);
  const [downloadedItem, setDownloadedItem] = useState<DownloadedItem | null>(
    null,
  );
  const [itemStatus, setItemStatus] = useState({
    isLoading: true,
    isError: false,
  });
  const handleRequireSyncPlayItem = useCallback(
    (targetItemId: string, startPositionTicks?: number) => {
      // Check both the loaded item and the URL param to prevent loops
      // (item?.Id may still be null while the page is loading the new itemId)
      if (
        !targetItemId ||
        targetItemId === item?.Id ||
        targetItemId === itemId
      ) {
        return;
      }

      router.replace({
        pathname: "/(auth)/player/direct-player",
        params: {
          itemId: targetItemId,
          offline: "false",
          playbackPosition: startPositionTicks?.toString(),
        },
      });
    },
    [item?.Id, itemId, router],
  );
  const syncPlay = useSyncPlay({
    currentItemId: item?.Id,
    getCurrentPositionMs: () => progress.get(),
    offline,
    onRequirePlaybackItem: handleRequireSyncPlayItem,
  });

  useEffect(() => {
    if (syncPlay.queueUpdate) {
      // Use the server-derived timestamp (already adjusted to local time) rather
      // than Date.now(). This accounts for network delay between when the server
      // set the position and when we processed the message.
      queueUpdateObservedAtRef.current =
        syncPlayCurrentPositionCapturedAtMs ?? Date.now();
    }
  }, [syncPlay.queueUpdate, syncPlayCurrentPositionCapturedAtMs]);

  const getAuthoritativeSyncPlayIsPlaying = useCallback((): boolean | null => {
    const groupState = syncPlay.stateUpdate?.State ?? syncPlay.groupInfo?.State;
    if (groupState === "Playing") {
      return true;
    }
    if (
      groupState === "Paused" ||
      groupState === "Waiting" ||
      groupState === "Idle"
    ) {
      return false;
    }

    const queueIsPlaying = syncPlay.queueUpdate?.IsPlaying;
    if (typeof queueIsPlaying !== "boolean") {
      return null;
    }

    const observedAtMs = queueUpdateObservedAtRef.current;
    if (
      observedAtMs <= 0 ||
      Date.now() - observedAtMs > SYNC_PLAY_QUEUE_PLAYBACK_STATE_MAX_AGE_MS
    ) {
      return null;
    }

    return queueIsPlaying;
  }, [
    syncPlay.stateUpdate?.State,
    syncPlay.groupInfo?.State,
    syncPlay.queueUpdate?.IsPlaying,
  ]);

  const currentSyncPlayQueueState = useMemo(() => {
    if (!syncPlay.queueUpdate || !item?.Id) {
      return null;
    }

    const currentIndex = syncPlay.queueUpdate.PlayingItemIndex;
    const playlist = syncPlay.queueUpdate.Playlist;
    if (
      typeof currentIndex !== "number" ||
      !Array.isArray(playlist) ||
      currentIndex < 0 ||
      currentIndex >= playlist.length
    ) {
      return null;
    }

    const queueItem = playlist[currentIndex];
    if (!queueItem?.ItemId || queueItem.ItemId !== item.Id) {
      return null;
    }

    return {
      startPositionTicks: syncPlay.queueUpdate.StartPositionTicks,
    };
  }, [syncPlay.queueUpdate, item?.Id]);

  // Resolve audio index: use URL param if provided, otherwise use stored index for offline playback
  const audioIndex = useMemo(() => {
    if (audioIndexFromUrl !== undefined) {
      return audioIndexFromUrl;
    }
    if (offline && downloadedItem?.userData?.audioStreamIndex !== undefined) {
      return downloadedItem.userData.audioStreamIndex;
    }
    return undefined;
  }, [audioIndexFromUrl, offline, downloadedItem?.userData?.audioStreamIndex]);

  // Get the playback speed for this item based on settings
  const { playbackSpeed: initialPlaybackSpeed } = usePlaybackSpeed(
    item,
    settings,
  );

  // Handler for changing playback speed
  const handleSetPlaybackSpeed = useCallback(
    async (speed: number, scope: PlaybackSpeedScope) => {
      // Cancel any active SpeedToSync so user speed takes priority
      if (speedSyncTimerRef.current) {
        clearTimeout(speedSyncTimerRef.current);
        speedSyncTimerRef.current = null;
      }
      isSpeedSyncingRef.current = false;

      // Update settings based on scope
      updatePlaybackSpeedSettings(
        speed,
        scope,
        item ?? undefined,
        settings,
        updateSettings,
      );

      // Apply speed to the current player (MPV)
      setCurrentPlaybackSpeed(speed);
      await videoRef.current?.setSpeed?.(speed);
    },
    [item, settings, updateSettings],
  );

  /** Gets the initial playback position from the URL. */
  const getInitialPlaybackTicks = useCallback((): number => {
    if (playbackPositionFromUrl) {
      return Number.parseInt(playbackPositionFromUrl, 10);
    }
    return item?.UserData?.PlaybackPositionTicks ?? 0;
  }, [playbackPositionFromUrl, item?.UserData?.PlaybackPositionTicks]);

  useEffect(() => {
    const fetchItemData = async () => {
      setItemStatus({ isLoading: true, isError: false });
      try {
        let fetchedItem: BaseItemDto | null = null;
        if (offline && !Platform.isTV) {
          const data = downloadUtils.getDownloadedItemById(itemId);
          if (data) {
            fetchedItem = data.item as BaseItemDto;
            setDownloadedItem(data);
          }
        } else {
          const res = await getUserLibraryApi(api!).getItem({
            itemId,
            userId: user?.Id,
          });
          fetchedItem = res.data;
        }
        setItem(fetchedItem);
        setItemStatus({ isLoading: false, isError: false });
      } catch (error) {
        console.error("Failed to fetch item:", error);
        setItemStatus({ isLoading: false, isError: true });
      }
    };

    if (itemId && (offline || api)) {
      fetchItemData();
    }
  }, [itemId, offline, api, user?.Id]);

  // Lock orientation based on user settings
  useEffect(() => {
    if (settings?.defaultVideoOrientation) {
      lockOrientation(settings.defaultVideoOrientation);
    }

    return () => {
      unlockOrientation();
    };
  }, [settings?.defaultVideoOrientation, lockOrientation, unlockOrientation]);

  interface Stream {
    mediaSource: MediaSourceInfo;
    sessionId: string;
    url: string;
  }

  const [stream, setStream] = useState<Stream | null>(null);
  const [streamStatus, setStreamStatus] = useState({
    isLoading: true,
    isError: false,
  });

  useEffect(() => {
    // Bail out immediately without any setState if item hasn't loaded yet.
    // This prevents cascading re-renders when combined with SyncPlay/WebSocket state updates.
    if (!item?.Id) {
      return;
    }

    const fetchStreamData = async () => {
      setStreamStatus({ isLoading: true, isError: false });
      try {
        let result: Stream | null = null;
        if (offline && downloadedItem && downloadedItem.mediaSource) {
          const url = downloadedItem.videoFilePath;
          if (item) {
            result = {
              mediaSource: downloadedItem.mediaSource,
              sessionId: "",
              url: url,
            };
          }
        } else {
          // Validate required parameters before calling getStreamUrl
          if (!api) {
            console.warn("API not available for streaming");
            setStreamStatus({ isLoading: false, isError: true });
            return;
          }
          if (!user?.Id) {
            console.warn("User not authenticated for streaming");
            setStreamStatus({ isLoading: false, isError: true });
            return;
          }

          // Calculate start ticks directly from item to avoid stale closure
          const startTicks = playbackPositionFromUrl
            ? Number.parseInt(playbackPositionFromUrl, 10)
            : (item?.UserData?.PlaybackPositionTicks ?? 0);

          const res = await getStreamUrl({
            api,
            item,
            startTimeTicks: startTicks,
            userId: user.Id,
            audioStreamIndex: audioIndex,
            maxStreamingBitrate: bitrateValue,
            mediaSourceId: mediaSourceId,
            subtitleStreamIndex: subtitleIndex,
            deviceProfile: generateDeviceProfile(),
          });
          if (!res) return;
          const { mediaSource, sessionId, url } = res;

          if (!sessionId || !mediaSource || !url) {
            Alert.alert(
              t("player.error"),
              t("player.failed_to_get_stream_url"),
            );
            return;
          }
          result = { mediaSource, sessionId, url };
        }
        setStream(result);
        setStreamStatus({ isLoading: false, isError: false });
      } catch (error) {
        console.error("Failed to fetch stream:", error);
        setStreamStatus({ isLoading: false, isError: true });
      }
    };
    fetchStreamData();
  }, [
    itemId,
    mediaSourceId,
    bitrateValue,
    api,
    item,
    user?.Id,
    downloadedItem,
  ]);

  useEffect(() => {
    if (!stream || !api || offline) return;
    const reportPlaybackStart = async () => {
      const progressInfo = currentPlayStateInfo();
      if (progressInfo) {
        await getPlaystateApi(api).reportPlaybackStart({
          playbackStartInfo: progressInfo,
        });
      }
    };
    reportPlaybackStart();
  }, [stream, api, offline]);

  const currentPlayStateInfo = useCallback(():
    | PlaybackProgressInfo
    | undefined => {
    if (!stream || !item?.Id) return;

    return {
      ItemId: item.Id,
      AudioStreamIndex: audioIndex ? audioIndex : undefined,
      SubtitleStreamIndex: subtitleIndex ? subtitleIndex : undefined,
      MediaSourceId: mediaSourceId,
      PositionTicks: msToTicks(progress.get()),
      IsPaused: !isPlaying,
      PlayMethod: stream?.url.includes("m3u8") ? "Transcode" : "DirectStream",
      PlaySessionId: stream.sessionId,
      IsMuted: isMuted,
      CanSeek: true,
      RepeatMode: RepeatMode.RepeatNone,
      PlaybackOrder: PlaybackOrder.Default,
    };
  }, [
    stream,
    item?.Id,
    audioIndex,
    subtitleIndex,
    mediaSourceId,
    progress,
    isPlaying,
    isMuted,
  ]);

  const buildSyncPlayPlayerStateRequest = useCallback(
    (isPlayingOverride?: boolean) => ({
      When: new Date().toISOString(),
      PositionTicks: msToTicks(progress.get()),
      IsPlaying: isPlayingOverride ?? isPlaying,
      PlaylistItemId: syncPlayPlaylistItemId ?? undefined,
    }),
    [progress, isPlaying, syncPlayPlaylistItemId],
  );

  const reportSyncPlayBuffering = useCallback(
    async (isPlayingOverride?: boolean) => {
      if (!api || offline || !isInSyncPlayGroup) return;
      try {
        await syncPlayBuffering(
          api,
          buildSyncPlayPlayerStateRequest(isPlayingOverride),
        );
      } catch (error) {
        console.warn("Failed to report SyncPlay buffering state:", error);
      }
    },
    [api, offline, isInSyncPlayGroup, buildSyncPlayPlayerStateRequest],
  );

  const reportSyncPlayReady = useCallback(
    async (isPlayingOverride?: boolean) => {
      if (!api || offline || !isInSyncPlayGroup) return;
      try {
        await syncPlayReady(
          api,
          buildSyncPlayPlayerStateRequest(isPlayingOverride),
        );
      } catch (error) {
        console.warn("Failed to report SyncPlay ready state:", error);
      }
    },
    [api, offline, isInSyncPlayGroup, buildSyncPlayPlayerStateRequest],
  );

  const reportSyncPlayPause = useCallback(async () => {
    if (!api || offline || !isInSyncPlayGroup) return;
    try {
      await syncPlayPause(api);
    } catch (error) {
      console.warn("Failed to report SyncPlay pause:", error);
    }
  }, [api, offline, isInSyncPlayGroup]);

  useEffect(() => {
    reportSyncPlayPauseRef.current = reportSyncPlayPause;
  }, [reportSyncPlayPause]);

  const reportSyncPlayPlay = useCallback(async () => {
    if (!api || offline || !isInSyncPlayGroup) return;
    try {
      await syncPlayPlay(api);
    } catch (error) {
      console.warn("Failed to report SyncPlay play:", error);
    }
  }, [api, offline, isInSyncPlayGroup]);

  const reportSyncPlaySeek = useCallback(
    async (positionTicks: number) => {
      if (!api || offline || !isInSyncPlayGroup) return;
      try {
        await syncPlaySeek(api, { PositionTicks: positionTicks });
      } catch (error) {
        console.warn("Failed to report SyncPlay seek:", error);
      }
    },
    [api, offline, isInSyncPlayGroup],
  );

  const pausePlaybackInternal = useCallback(
    async (reportSyncPlay = true) => {
      if (!isPlayingRef.current) return;

      isPlayingRef.current = false;
      setIsPlaying(false);
      await videoRef.current?.pause();

      const progressInfo = currentPlayStateInfo();
      if (progressInfo) {
        playbackManager.reportPlaybackProgress(progressInfo);
      }

      if (reportSyncPlay) {
        lastLocalPlayPauseCommandAtRef.current = Date.now();
        await reportSyncPlayPause();
      }
    },
    [currentPlayStateInfo, playbackManager, reportSyncPlayPause, videoRef],
  );

  const playPlaybackInternal = useCallback(
    async (reportSyncPlay = true) => {
      if (isPlayingRef.current) return;

      isPlayingRef.current = true;
      setIsPlaying(true);
      videoRef.current?.play();

      const progressInfo = currentPlayStateInfo();
      if (!offline && api) {
        await getPlaystateApi(api).reportPlaybackStart({
          playbackStartInfo: progressInfo,
        });
      }

      if (reportSyncPlay) {
        lastLocalPlayPauseCommandAtRef.current = Date.now();
        await reportSyncPlayPlay();
      }
    },
    [videoRef, currentPlayStateInfo, offline, api, reportSyncPlayPlay],
  );

  const togglePlay = useCallback(async () => {
    lightHapticFeedback();
    if (isPlayingRef.current) {
      await pausePlaybackInternal(true);
      return;
    }
    await playPlaybackInternal(true);
  }, [lightHapticFeedback, pausePlaybackInternal, playPlaybackInternal]);

  const playFromSyncPlay = useCallback(() => {
    void playPlaybackInternal(false);
  }, [playPlaybackInternal]);

  const pauseFromSyncPlay = useCallback(() => {
    void pausePlaybackInternal(false);
  }, [pausePlaybackInternal]);

  const seekInternal = useCallback(
    (positionMs: number, reportSyncPlay = true) => {
      // MPV expects seconds, convert from ms.
      videoRef.current?.seekTo?.(positionMs / 1000);
      if (reportSyncPlay) {
        void reportSyncPlaySeek(msToTicks(positionMs));
      }
    },
    [reportSyncPlaySeek],
  );

  const seekFromSyncPlay = useCallback(
    (positionTicks: number) => {
      lastSyncPlaySeekAtRef.current = Date.now();
      // Proactively report buffering — seeking will cause a rebuffer
      // and the server should know we're not ready yet.
      void reportSyncPlayBuffering(isPlaying);
      lastReportedSyncPlayBufferingRef.current = true;
      seekInternal(ticksToMs(positionTicks), false);
    },
    [seekInternal, reportSyncPlayBuffering, isPlaying],
  );

  useEffect(() => {
    if (!showSyncPlayModal) {
      return;
    }

    void syncPlay.refreshGroups();
    if (syncPlay.inGroup) {
      void syncPlay.refreshCurrentGroup();
    }
  }, [
    showSyncPlayModal,
    syncPlay.inGroup,
    syncPlay.refreshGroups,
    syncPlay.refreshCurrentGroup,
  ]);

  useEffect(() => {
    if (
      !api ||
      offline ||
      !isInSyncPlayGroup ||
      !isVideoLoaded ||
      syncPlay.ignoreWait
    ) {
      lastReportedSyncPlayBufferingRef.current = null;
      if (bufferingDebounceTimerRef.current) {
        clearTimeout(bufferingDebounceTimerRef.current);
        bufferingDebounceTimerRef.current = null;
      }
      return;
    }

    if (lastReportedSyncPlayBufferingRef.current === isBuffering) {
      return;
    }

    if (isBuffering) {
      // Debounce: wait before telling the server we're buffering.
      // Brief stalls resolve on their own and don't need to pause the group.
      bufferingDebounceTimerRef.current = setTimeout(() => {
        bufferingDebounceTimerRef.current = null;
        lastReportedSyncPlayBufferingRef.current = true;
        void reportSyncPlayBuffering(isPlaying);
      }, SYNC_PLAY_BUFFERING_DEBOUNCE_MS);
      return;
    }

    // Ready: report immediately and cancel any pending buffering notification.
    if (bufferingDebounceTimerRef.current) {
      clearTimeout(bufferingDebounceTimerRef.current);
      bufferingDebounceTimerRef.current = null;
    }
    lastReportedSyncPlayBufferingRef.current = false;
    void reportSyncPlayReady(isPlaying);
  }, [
    api,
    offline,
    isInSyncPlayGroup,
    isVideoLoaded,
    isBuffering,
    isPlaying,
    syncPlay.ignoreWait,
    reportSyncPlayBuffering,
    reportSyncPlayReady,
  ]);

  useEffect(() => {
    const wasConnected = wasSocketConnectedRef.current;
    if (
      !wasConnected &&
      isConnected &&
      syncPlay.inGroup &&
      !syncPlay.ignoreWait &&
      isVideoLoaded &&
      !offline
    ) {
      void reportSyncPlayReady(isPlaying);
    }
    wasSocketConnectedRef.current = isConnected;
  }, [
    isConnected,
    syncPlay.inGroup,
    syncPlay.ignoreWait,
    isVideoLoaded,
    offline,
    isPlaying,
    reportSyncPlayReady,
  ]);

  useEffect(() => {
    if (
      !syncPlay.inGroup ||
      syncPlay.ignoreWait ||
      !currentSyncPlayQueueState ||
      offline
    ) {
      return;
    }

    // Skip if a local play/pause command was just sent — give the server
    // time to process and broadcast the state change before we override.
    if (
      Date.now() - lastLocalPlayPauseCommandAtRef.current <
      SYNC_PLAY_RESYNC_COOLDOWN_MS
    ) {
      return;
    }

    const syncPlayIsPlaying = getAuthoritativeSyncPlayIsPlaying();
    if (syncPlayIsPlaying === true && !isPlaying && !isBuffering) {
      playFromSyncPlay();
      return;
    }

    if (syncPlayIsPlaying === false && isPlaying) {
      pauseFromSyncPlay();
    }
  }, [
    syncPlay.inGroup,
    syncPlay.ignoreWait,
    currentSyncPlayQueueState,
    offline,
    isPlaying,
    isBuffering,
    playFromSyncPlay,
    pauseFromSyncPlay,
    getAuthoritativeSyncPlayIsPlaying,
  ]);

  // Clean up SpeedToSync timer on unmount or when leaving group.
  useEffect(() => {
    return () => {
      if (speedSyncTimerRef.current) {
        clearTimeout(speedSyncTimerRef.current);
        speedSyncTimerRef.current = null;
      }
      isSpeedSyncingRef.current = false;
    };
  }, [syncPlay.inGroup]);

  useEffect(() => {
    if (
      !settings?.syncPlaySyncCorrection ||
      !syncPlay.inGroup ||
      syncPlay.ignoreWait ||
      !currentSyncPlayQueueState ||
      offline
    ) {
      return;
    }

    const restoreUserSpeed = () => {
      isSpeedSyncingRef.current = false;
      void videoRef.current?.setSpeed?.(currentPlaybackSpeed);
    };

    const runSyncCorrection = () => {
      if (isSeeking.get() || isBuffering) {
        return;
      }

      const startPositionTicks = currentSyncPlayQueueState.startPositionTicks;
      if (typeof startPositionTicks !== "number") {
        return;
      }

      let targetTicks = startPositionTicks;
      if (getAuthoritativeSyncPlayIsPlaying() === true) {
        const observedAtMs = queueUpdateObservedAtRef.current;
        if (observedAtMs > 0) {
          targetTicks += msToTicks(Math.max(0, Date.now() - observedAtMs));
        }
      }

      const localTicks = msToTicks(progress.get());
      // Signed drift: positive = we're behind, negative = we're ahead.
      const driftTicks = targetTicks - localTicks;
      const driftMs = driftTicks / 10_000;
      const absDriftMs = Math.abs(driftMs);
      const now = Date.now();

      // Drift is negligible — ensure we're back to user speed if needed.
      if (absDriftMs < SYNC_PLAY_MIN_DRIFT_SPEED_SYNC_MS) {
        if (isSpeedSyncingRef.current) {
          if (speedSyncTimerRef.current) {
            clearTimeout(speedSyncTimerRef.current);
            speedSyncTimerRef.current = null;
          }
          restoreUserSpeed();
        }
        return;
      }

      // On cooldown from a recent seek — skip.
      if (
        now - lastSyncPlaySeekAtRef.current < SYNC_PLAY_RESYNC_COOLDOWN_MS ||
        now - lastDriftCorrectionAtRef.current < SYNC_PLAY_RESYNC_COOLDOWN_MS
      ) {
        return;
      }

      // SpeedToSync: smooth catch-up for small drifts.
      if (absDriftMs <= SYNC_PLAY_MAX_DRIFT_SPEED_SYNC_MS) {
        if (isSpeedSyncingRef.current) {
          return; // Already adjusting speed — let it finish.
        }

        // Calculate adjusted speed: speed up or slow down proportionally.
        const ratio = 1 + driftMs / SYNC_PLAY_SPEED_SYNC_DURATION_MS;
        const syncSpeed = Math.max(
          SYNC_PLAY_MIN_SPEED_CLAMP,
          currentPlaybackSpeed * ratio,
        );

        isSpeedSyncingRef.current = true;
        lastDriftCorrectionAtRef.current = now;
        void videoRef.current?.setSpeed?.(syncSpeed);

        // Restore user speed after the sync duration.
        if (speedSyncTimerRef.current) {
          clearTimeout(speedSyncTimerRef.current);
        }
        speedSyncTimerRef.current = setTimeout(() => {
          speedSyncTimerRef.current = null;
          restoreUserSpeed();
        }, SYNC_PLAY_SPEED_SYNC_DURATION_MS);
        return;
      }

      // SkipToSync: hard seek for large drifts.
      if (absDriftMs >= SYNC_PLAY_MIN_DRIFT_SKIP_SYNC_MS) {
        // Cancel any active SpeedToSync.
        if (speedSyncTimerRef.current) {
          clearTimeout(speedSyncTimerRef.current);
          speedSyncTimerRef.current = null;
        }
        if (isSpeedSyncingRef.current) {
          restoreUserSpeed();
        }

        lastDriftCorrectionAtRef.current = now;
        // Random ±50ms offset to prevent resonance between clients.
        const randomOffsetTicks = msToTicks(Math.random() * 100 - 50);
        seekFromSyncPlay(targetTicks + randomOffsetTicks);
      }
    };

    runSyncCorrection();
    const interval = setInterval(
      runSyncCorrection,
      SYNC_PLAY_DRIFT_CHECK_INTERVAL_MS,
    );

    return () => {
      clearInterval(interval);
    };
  }, [
    settings?.syncPlaySyncCorrection,
    syncPlay.inGroup,
    syncPlay.ignoreWait,
    currentSyncPlayQueueState,
    offline,
    isSeeking,
    isBuffering,
    progress,
    seekFromSyncPlay,
    getAuthoritativeSyncPlayIsPlaying,
    currentPlaybackSpeed,
  ]);

  // Immediate position sync when video first loads in a SyncPlay group.
  // The periodic drift correction has a 2s interval + cooldown, so without
  // this the player can start seconds behind the group.
  const hasPerformedInitialSyncRef = useRef(false);
  useEffect(() => {
    if (
      !isVideoLoaded ||
      hasPerformedInitialSyncRef.current ||
      !syncPlay.inGroup ||
      syncPlay.ignoreWait ||
      !currentSyncPlayQueueState ||
      offline
    ) {
      return;
    }

    const startPositionTicks = currentSyncPlayQueueState.startPositionTicks;
    if (typeof startPositionTicks !== "number") {
      return;
    }

    let targetTicks = startPositionTicks;
    if (getAuthoritativeSyncPlayIsPlaying() === true) {
      const observedAtMs = queueUpdateObservedAtRef.current;
      if (observedAtMs > 0) {
        targetTicks += msToTicks(Math.max(0, Date.now() - observedAtMs));
      }
    }

    hasPerformedInitialSyncRef.current = true;
    seekFromSyncPlay(targetTicks);
  }, [
    isVideoLoaded,
    syncPlay.inGroup,
    syncPlay.ignoreWait,
    currentSyncPlayQueueState,
    offline,
    seekFromSyncPlay,
    getAuthoritativeSyncPlayIsPlaying,
  ]);

  // Safety net: always-on large-drift catch, independent of the sync
  // correction setting. Catches catastrophic desync from backgrounding,
  // missed commands, etc. Uses a relaxed 5s threshold — if you're this
  // far off, something went wrong and we should fix it silently.
  useEffect(() => {
    if (
      !syncPlay.inGroup ||
      syncPlay.ignoreWait ||
      !currentSyncPlayQueueState ||
      offline ||
      !isVideoLoaded
    ) {
      return;
    }

    const checkSafetyNet = () => {
      if (isSeeking.get() || isBuffering || !isPlayingRef.current) {
        return;
      }

      const startPositionTicks = currentSyncPlayQueueState.startPositionTicks;
      if (typeof startPositionTicks !== "number") {
        return;
      }

      if (getAuthoritativeSyncPlayIsPlaying() !== true) {
        return;
      }

      const observedAtMs = queueUpdateObservedAtRef.current;
      if (observedAtMs <= 0) {
        return;
      }

      const targetTicks =
        startPositionTicks + msToTicks(Math.max(0, Date.now() - observedAtMs));
      const localTicks = msToTicks(progress.get());
      const absDriftMs = Math.abs((targetTicks - localTicks) / 10_000);

      if (absDriftMs < SYNC_PLAY_SAFETY_NET_DRIFT_MS) {
        return;
      }

      const now = Date.now();
      if (
        now - lastSyncPlaySeekAtRef.current < SYNC_PLAY_RESYNC_COOLDOWN_MS ||
        now - lastDriftCorrectionAtRef.current < SYNC_PLAY_RESYNC_COOLDOWN_MS
      ) {
        return;
      }

      lastDriftCorrectionAtRef.current = now;
      seekFromSyncPlay(targetTicks);
    };

    const interval = setInterval(
      checkSafetyNet,
      SYNC_PLAY_SAFETY_NET_CHECK_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [
    syncPlay.inGroup,
    syncPlay.ignoreWait,
    currentSyncPlayQueueState,
    offline,
    isVideoLoaded,
    isSeeking,
    isBuffering,
    progress,
    seekFromSyncPlay,
    getAuthoritativeSyncPlayIsPlaying,
  ]);

  // Re-sync position when the app returns from background.
  // Mobile apps get backgrounded frequently; the player stalls while
  // backgrounded and the position becomes stale.
  useEffect(() => {
    if (
      !syncPlay.inGroup ||
      syncPlay.ignoreWait ||
      !currentSyncPlayQueueState ||
      offline ||
      !isVideoLoaded
    ) {
      return;
    }

    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        return;
      }

      // App just came to foreground — re-sync position.
      const startPositionTicks = currentSyncPlayQueueState.startPositionTicks;
      if (typeof startPositionTicks !== "number") {
        return;
      }

      if (getAuthoritativeSyncPlayIsPlaying() !== true) {
        return;
      }

      const observedAtMs = queueUpdateObservedAtRef.current;
      if (observedAtMs <= 0) {
        return;
      }

      const targetTicks =
        startPositionTicks + msToTicks(Math.max(0, Date.now() - observedAtMs));

      seekFromSyncPlay(targetTicks);
      // Also let the server know we're ready (WebSocket may have reconnected).
      void reportSyncPlayReady(true);
    });

    return () => subscription.remove();
  }, [
    syncPlay.inGroup,
    syncPlay.ignoreWait,
    currentSyncPlayQueueState,
    offline,
    isVideoLoaded,
    seekFromSyncPlay,
    getAuthoritativeSyncPlayIsPlaying,
    reportSyncPlayReady,
  ]);

  const reportPlaybackStopped = useCallback(async () => {
    if (!item?.Id || !stream?.sessionId || offline || !api) return;

    const currentTimeInTicks = msToTicks(progress.get());
    await getPlaystateApi(api).onPlaybackStopped({
      itemId: item.Id,
      mediaSourceId: mediaSourceId,
      positionTicks: currentTimeInTicks,
      playSessionId: stream.sessionId,
    });
  }, [
    api,
    item,
    mediaSourceId,
    stream,
    progress,
    offline,
    revalidateProgressCache,
  ]);

  const stop = useCallback(() => {
    // Update URL with final playback position before stopping
    router.setParams({
      playbackPosition: msToTicks(progress.get()).toString(),
    });
    reportPlaybackStopped();
    setIsPlaybackStopped(true);
    videoRef.current?.pause();
    revalidateProgressCache();
  }, [videoRef, reportPlaybackStopped, progress]);

  useEffect(() => {
    const beforeRemoveListener = navigation.addListener("beforeRemove", stop);
    return () => {
      beforeRemoveListener();
    };
  }, [navigation, stop]);

  const lastUrlUpdateTime = useSharedValue(0);
  const wasJustSeeking = useSharedValue(false);
  const URL_UPDATE_INTERVAL = 30000; // Update URL every 30 seconds instead of every second

  // Track when seeking ends to update URL immediately
  useAnimatedReaction(
    () => isSeeking.get(),
    (currentSeeking, previousSeeking) => {
      if (previousSeeking && !currentSeeking) {
        // Seeking just ended
        wasJustSeeking.value = true;
      }
    },
    [],
  );

  /** Progress handler for MPV - position in seconds */
  const onProgress = useCallback(
    async (data: { nativeEvent: MpvOnProgressEventPayload }) => {
      if (isSeeking.get() || isPlaybackStopped) return;

      const { position, cacheSeconds } = data.nativeEvent;
      // MPV reports position in seconds, convert to ms
      const currentTime = position * 1000;

      if (isBuffering) {
        setIsBuffering(false);
      }

      progress.set(currentTime);

      // Update cache progress (current position + buffered seconds ahead)
      if (cacheSeconds !== undefined && cacheSeconds > 0) {
        const cacheEnd = currentTime + cacheSeconds * 1000;
        cacheProgress.set(cacheEnd);
      }

      // Update URL immediately after seeking, or every 30 seconds during normal playback
      const now = Date.now();
      const shouldUpdateUrl = wasJustSeeking.get();
      wasJustSeeking.value = false;

      if (
        shouldUpdateUrl ||
        now - lastUrlUpdateTime.get() > URL_UPDATE_INTERVAL
      ) {
        router.setParams({
          playbackPosition: msToTicks(currentTime).toString(),
        });
        lastUrlUpdateTime.value = now;
      }

      if (!item?.Id) return;

      playbackManager.reportPlaybackProgress(
        currentPlayStateInfo() as PlaybackProgressInfo,
      );
    },
    [
      item?.Id,
      audioIndex,
      subtitleIndex,
      mediaSourceId,
      isPlaying,
      stream,
      isSeeking,
      isPlaybackStopped,
      isBuffering,
    ],
  );

  /** Gets the initial playback position in seconds. */
  const _startPosition = useMemo(() => {
    return ticksToSeconds(getInitialPlaybackTicks());
  }, [getInitialPlaybackTicks]);

  /** Prepare metadata for iOS native media controls (Control Center, Lock Screen) */
  const nowPlayingMetadata = useMemo(() => {
    if (!item || !api) return undefined;

    const artworkUri = getPrimaryImageUrl({
      api,
      item,
      quality: 90,
      width: 500,
    });

    return {
      title: item.Name || "",
      artist:
        item.Type === "Episode"
          ? item.SeriesName || ""
          : item.AlbumArtist || "",
      albumTitle:
        item.Type === "Episode" && item.SeasonName
          ? item.SeasonName
          : undefined,
      artworkUri: artworkUri || undefined,
    };
  }, [item, api]);

  /** Build video source config for MPV */
  const videoSource = useMemo<MpvVideoSource | undefined>(() => {
    if (!stream?.url) return undefined;

    const mediaSource = stream.mediaSource;
    const isTranscoding = Boolean(mediaSource?.TranscodingUrl);

    // Get external subtitle URLs
    // - Online: prepend API base path to server URLs
    // - Offline: use local file paths (stored in DeliveryUrl during download)
    let externalSubs: string[] | undefined;
    if (!offline && api?.basePath) {
      externalSubs = mediaSource?.MediaStreams?.filter(
        (s) =>
          s.Type === "Subtitle" &&
          s.DeliveryMethod === "External" &&
          s.DeliveryUrl,
      ).map((s) => `${api.basePath}${s.DeliveryUrl}`);
    } else if (offline) {
      externalSubs = mediaSource?.MediaStreams?.filter(
        (s) =>
          s.Type === "Subtitle" &&
          s.DeliveryMethod === "External" &&
          s.DeliveryUrl,
      ).map((s) => s.DeliveryUrl!);
    }

    // Calculate track IDs for initial selection
    const initialSubtitleId = getMpvSubtitleId(
      mediaSource,
      subtitleIndex,
      isTranscoding,
    );
    const initialAudioId = getMpvAudioId(
      mediaSource,
      audioIndex,
      isTranscoding,
    );

    // Calculate start position directly here to avoid timing issues
    const startTicks = playbackPositionFromUrl
      ? Number.parseInt(playbackPositionFromUrl, 10)
      : (item?.UserData?.PlaybackPositionTicks ?? 0);
    const startPos = ticksToSeconds(startTicks);

    // Build source config - headers only needed for online streaming
    const source: MpvVideoSource = {
      url: stream.url,
      startPosition: startPos,
      autoplay: true,
      initialSubtitleId,
      initialAudioId,
    };

    // Add external subtitles only for online playback
    if (externalSubs && externalSubs.length > 0) {
      source.externalSubtitles = externalSubs;
    }

    // Add auth headers only for online streaming (not for local file:// URLs)
    if (!offline && api?.accessToken) {
      source.headers = {
        Authorization: `MediaBrowser Token="${api.accessToken}"`,
      };
    }

    return source;
  }, [
    stream?.url,
    stream?.mediaSource,
    item?.UserData?.PlaybackPositionTicks,
    playbackPositionFromUrl,
    api?.basePath,
    api?.accessToken,
    subtitleIndex,
    audioIndex,
    offline,
  ]);

  const volumeUpCb = useCallback(async () => {
    if (Platform.isTV) return;

    try {
      const { volume: currentVolume } = await VolumeManager.getVolume();
      const newVolume = Math.min(currentVolume + 0.1, 1.0);

      await VolumeManager.setVolume(newVolume);
    } catch (error) {
      console.error("Error adjusting volume:", error);
    }
  }, []);
  const [previousVolume, setPreviousVolume] = useState<number | null>(null);

  const toggleMuteCb = useCallback(async () => {
    if (Platform.isTV) return;

    try {
      const { volume: currentVolume } = await VolumeManager.getVolume();
      const currentVolumePercent = currentVolume * 100;

      if (currentVolumePercent > 0) {
        // Currently not muted, so mute
        setPreviousVolume(currentVolumePercent);
        await VolumeManager.setVolume(0);
        setIsMuted(true);
      } else {
        // Currently muted, so restore previous volume
        const volumeToRestore = previousVolume || 50; // Default to 50% if no previous volume
        await VolumeManager.setVolume(volumeToRestore / 100);
        setPreviousVolume(null);
        setIsMuted(false);
      }
    } catch (error) {
      console.error("Error toggling mute:", error);
    }
  }, [previousVolume]);

  const volumeDownCb = useCallback(async () => {
    if (Platform.isTV) return;

    try {
      const { volume: currentVolume } = await VolumeManager.getVolume();
      const newVolume = Math.max(currentVolume - 0.1, 0); // Decrease by 10%
      console.log(
        "Volume Down",
        Math.round(currentVolume * 100),
        "→",
        Math.round(newVolume * 100),
      );
      await VolumeManager.setVolume(newVolume);
    } catch (error) {
      console.error("Error adjusting volume:", error);
    }
  }, []);

  const setVolumeCb = useCallback(async (newVolume: number) => {
    if (Platform.isTV) return;

    try {
      const clampedVolume = Math.max(0, Math.min(newVolume, 100));
      console.log("Setting volume to", clampedVolume);
      await VolumeManager.setVolume(clampedVolume / 100);
    } catch (error) {
      console.error("Error setting volume:", error);
    }
  }, []);

  const getCurrentPositionTicks = useCallback(
    () => msToTicks(progress.get()),
    [progress],
  );

  useWebSocket({
    isPlaying: isPlaying,
    togglePlay: togglePlay,
    stopPlayback: stop,
    offline,
    playPlayback: playFromSyncPlay,
    pausePlayback: pauseFromSyncPlay,
    seekPlayback: seekFromSyncPlay,
    getCurrentPositionTicks,
    toggleMute: toggleMuteCb,
    volumeUp: volumeUpCb,
    volumeDown: volumeDownCb,
    setVolume: setVolumeCb,
  });

  /** Playback state handler for MPV */
  const onPlaybackStateChanged = useCallback(
    async (e: { nativeEvent: MpvOnPlaybackStateChangePayload }) => {
      const { isPaused, isPlaying: playing, isLoading } = e.nativeEvent;

      if (playing) {
        setIsPlaying(true);
        setIsBuffering(false);
        setHasPlaybackStarted(true);
        if (item?.Id) {
          playbackManager.reportPlaybackProgress(
            currentPlayStateInfo() as PlaybackProgressInfo,
          );
        }
        if (!Platform.isTV) await activateKeepAwakeAsync();
        return;
      }

      if (isPaused) {
        // Detect system-initiated pause (phone call, Siri, headphone disconnect).
        // When WE pause, isPlayingRef is set to false BEFORE the native event fires.
        // A system pause fires the native event while isPlayingRef is still true.
        const wasSystemPause = isPlayingRef.current;

        setIsPlaying(false);
        if (item?.Id) {
          playbackManager.reportPlaybackProgress(
            currentPlayStateInfo() as PlaybackProgressInfo,
          );
        }

        // Report to SyncPlay group so everyone pauses together.
        if (wasSystemPause) {
          lastLocalPlayPauseCommandAtRef.current = Date.now();
          void reportSyncPlayPauseRef.current?.();
        }

        if (!Platform.isTV) await deactivateKeepAwake();
        return;
      }

      if (isLoading !== undefined) {
        setIsBuffering(isLoading);
      }
    },
    [playbackManager, item?.Id, progress],
  );

  /** PiP handler for MPV */
  const _onPictureInPictureChange = useCallback(
    (e: { nativeEvent: { isActive: boolean } }) => {
      const { isActive } = e.nativeEvent;
      setIsPipMode(isActive);
      // Hide controls when entering PiP
      if (isActive) {
        _setShowControls(false);
      }
    },
    [],
  );

  const [isMounted, setIsMounted] = useState(false);

  // Add useEffect to handle mounting
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Memoize video ref functions to prevent unnecessary re-renders
  const startPictureInPicture = useCallback(async () => {
    return videoRef.current?.startPictureInPicture?.();
  }, []);

  const play = useCallback(() => {
    void playPlaybackInternal(false);
  }, [playPlaybackInternal]);

  const pause = useCallback(() => {
    void pausePlaybackInternal(false);
  }, [pausePlaybackInternal]);

  const seek = useCallback(
    (position: number) => {
      seekInternal(position, true);
    },
    [seekInternal],
  );

  // Technical info toggle handler
  const handleToggleTechnicalInfo = useCallback(() => {
    setShowTechnicalInfo((prev) => !prev);
  }, []);

  // Get technical info from the player
  const getTechnicalInfo = useCallback(async () => {
    return (await videoRef.current?.getTechnicalInfo?.()) ?? {};
  }, []);

  // Determine play method based on stream URL and media source
  const playMethod = useMemo<
    "DirectPlay" | "DirectStream" | "Transcode" | undefined
  >(() => {
    if (!stream?.url) return undefined;

    // Check if transcoding (m3u8 playlist or TranscodingUrl present)
    if (stream.url.includes("m3u8") || stream.mediaSource?.TranscodingUrl) {
      return "Transcode";
    }

    // Check if direct play (no container remuxing needed)
    // Direct play means the file is being served as-is
    if (stream.url.includes("/Videos/") && stream.url.includes("/stream")) {
      return "DirectStream";
    }

    // Default to direct play if we're not transcoding
    return "DirectPlay";
  }, [stream?.url, stream?.mediaSource?.TranscodingUrl]);

  // Extract transcode reasons from the TranscodingUrl
  const transcodeReasons = useMemo<string[]>(() => {
    const transcodingUrl = stream?.mediaSource?.TranscodingUrl;
    if (!transcodingUrl) return [];

    try {
      // Parse the TranscodeReasons parameter from the URL
      const url = new URL(transcodingUrl, "http://localhost");
      const reasons = url.searchParams.get("TranscodeReasons");
      if (reasons) {
        return reasons.split(",").filter(Boolean);
      }
    } catch {
      // If URL parsing fails, try regex fallback
      const match = transcodingUrl.match(/TranscodeReasons=([^&]+)/);
      if (match) {
        return match[1].split(",").filter(Boolean);
      }
    }
    return [];
  }, [stream?.mediaSource?.TranscodingUrl]);

  const handleZoomToggle = useCallback(async () => {
    const newZoomState = !isZoomedToFill;
    await videoRef.current?.setZoomedToFill?.(newZoomState);
    setIsZoomedToFill(newZoomState);

    // Adjust subtitle position to compensate for video cropping when zoomed
    if (newZoomState) {
      // Get video dimensions from mediaSource
      const videoStream = stream?.mediaSource?.MediaStreams?.find(
        (s) => s.Type === "Video",
      );
      const videoWidth = videoStream?.Width ?? 1920;
      const videoHeight = videoStream?.Height ?? 1080;

      const videoAR = videoWidth / videoHeight;
      const screenAR = screenWidth / screenHeight;

      if (screenAR > videoAR) {
        // Screen is wider than video - video height extends beyond screen
        // Calculate how much of the video is cropped at the bottom (as % of video height)
        const bottomCropPercent = 50 * (1 - videoAR / screenAR);
        // Only adjust by 70% of the crop to keep a comfortable margin from the edge
        // (subtitles already have some built-in padding from the bottom)
        const adjustmentFactor = 0.7;
        const newSubPos = Math.round(
          100 - bottomCropPercent * adjustmentFactor,
        );
        await videoRef.current?.setSubtitlePosition?.(newSubPos);
      }
      // If videoAR >= screenAR, sides are cropped but bottom is visible, no adjustment needed
    } else {
      // Restore to default position (bottom of video frame)
      await videoRef.current?.setSubtitlePosition?.(100);
    }
  }, [isZoomedToFill, stream?.mediaSource, screenWidth, screenHeight]);

  // Apply subtitle settings when video loads
  useEffect(() => {
    if (!isVideoLoaded || !videoRef.current) return;

    const applySubtitleSettings = async () => {
      if (settings.mpvSubtitleScale !== undefined) {
        await videoRef.current?.setSubtitleScale?.(settings.mpvSubtitleScale);
      }
      if (settings.mpvSubtitleMarginY !== undefined) {
        await videoRef.current?.setSubtitleMarginY?.(
          settings.mpvSubtitleMarginY,
        );
      }
      if (settings.mpvSubtitleAlignX !== undefined) {
        await videoRef.current?.setSubtitleAlignX?.(settings.mpvSubtitleAlignX);
      }
      if (settings.mpvSubtitleAlignY !== undefined) {
        await videoRef.current?.setSubtitleAlignY?.(settings.mpvSubtitleAlignY);
      }
      if (settings.mpvSubtitleFontSize !== undefined) {
        await videoRef.current?.setSubtitleFontSize?.(
          settings.mpvSubtitleFontSize,
        );
      }
      // Apply subtitle size from general settings
      if (settings.subtitleSize) {
        await videoRef.current?.setSubtitleFontSize?.(settings.subtitleSize);
      }
    };

    applySubtitleSettings();
  }, [isVideoLoaded, settings]);

  // Apply initial playback speed when video loads
  useEffect(() => {
    if (!isVideoLoaded || !videoRef.current) return;

    const applyInitialPlaybackSpeed = async () => {
      if (initialPlaybackSpeed !== 1.0) {
        setCurrentPlaybackSpeed(initialPlaybackSpeed);
        await videoRef.current?.setSpeed?.(initialPlaybackSpeed);
      }
    };

    applyInitialPlaybackSpeed();
  }, [isVideoLoaded, initialPlaybackSpeed]);

  // Show error UI first, before checking loading/missing‐data
  if (itemStatus.isError || streamStatus.isError) {
    return (
      <View className='w-screen h-screen flex flex-col items-center justify-center bg-black'>
        <Text className='text-white'>{t("player.error")}</Text>
      </View>
    );
  }

  // Then show loader while either side is still fetching or data isn't present
  if (itemStatus.isLoading || streamStatus.isLoading || !item || !stream) {
    // …loader UI…
    return (
      <View className='w-screen h-screen flex flex-col items-center justify-center bg-black'>
        <Loader />
      </View>
    );
  }

  if (itemStatus.isError || streamStatus.isError)
    return (
      <View className='w-screen h-screen flex flex-col items-center justify-center bg-black'>
        <Text className='text-white'>{t("player.error")}</Text>
      </View>
    );

  return (
    <OfflineModeProvider isOffline={offline}>
      <PlayerProvider
        playerRef={videoRef}
        item={item}
        mediaSource={stream?.mediaSource}
        isVideoLoaded={isVideoLoaded}
        tracksReady={tracksReady}
        downloadedItem={downloadedItem}
      >
        <VideoProvider>
          <View
            style={{
              flex: 1,
              backgroundColor: "black",
              height: "100%",
              width: "100%",
            }}
          >
            <View
              style={{
                display: "flex",
                width: "100%",
                height: "100%",
                position: "relative",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <MpvPlayerView
                ref={videoRef}
                source={videoSource}
                style={{ width: "100%", height: "100%" }}
                nowPlayingMetadata={nowPlayingMetadata}
                onProgress={onProgress}
                onPlaybackStateChange={onPlaybackStateChanged}
                onLoad={() => setIsVideoLoaded(true)}
                onError={(e: { nativeEvent: MpvOnErrorEventPayload }) => {
                  console.error("Video Error:", e.nativeEvent);
                  Alert.alert(
                    t("player.error"),
                    t("player.an_error_occured_while_playing_the_video"),
                  );
                  writeToLog("ERROR", "Video Error", e.nativeEvent);
                }}
                onTracksReady={() => {
                  setTracksReady(true);
                }}
              />
              {!hasPlaybackStarted && (
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: "black",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Loader />
                </View>
              )}
            </View>
            {isMounted === true && item && !isPipMode && (
              <Controls
                mediaSource={stream?.mediaSource}
                item={item}
                togglePlay={togglePlay}
                isPlaying={isPlaying}
                isSeeking={isSeeking}
                progress={progress}
                cacheProgress={cacheProgress}
                isBuffering={isBuffering}
                showControls={showControls}
                setShowControls={setShowControls}
                startPictureInPicture={startPictureInPicture}
                play={play}
                pause={pause}
                seek={seek}
                enableTrickplay={true}
                aspectRatio={aspectRatio}
                isZoomedToFill={isZoomedToFill}
                onZoomToggle={handleZoomToggle}
                api={api}
                downloadedFiles={downloadedFiles}
                playbackSpeed={currentPlaybackSpeed}
                setPlaybackSpeed={handleSetPlaybackSpeed}
                showTechnicalInfo={showTechnicalInfo}
                onToggleTechnicalInfo={handleToggleTechnicalInfo}
                getTechnicalInfo={getTechnicalInfo}
                playMethod={playMethod}
                transcodeReasons={transcodeReasons}
                isInSyncPlayGroup={syncPlay.inGroup}
                openSyncPlay={() => setShowSyncPlayModal(true)}
              />
            )}
            <SyncPlayModal
              visible={showSyncPlayModal}
              onClose={() => setShowSyncPlayModal(false)}
              inGroup={syncPlay.inGroup}
              groupId={syncPlay.groupId}
              groupInfo={syncPlay.groupInfo}
              queueUpdate={syncPlay.queueUpdate}
              queueItemNames={syncPlay.queueItemNames}
              groups={syncPlay.groups}
              groupsLoading={syncPlay.groupsLoading}
              actionLoading={syncPlay.actionLoading}
              error={syncPlay.error}
              ignoreWait={syncPlay.ignoreWait}
              currentItemId={item.Id ?? undefined}
              refreshGroups={syncPlay.refreshGroups}
              createGroup={syncPlay.createGroup}
              joinGroup={syncPlay.joinGroup}
              leaveGroup={syncPlay.leaveGroup}
              toggleIgnoreWait={syncPlay.toggleIgnoreWait}
              setNewQueueFromCurrentItem={syncPlay.setNewQueueFromCurrentItem}
              queueCurrentItem={syncPlay.queueCurrentItem}
              clearPlaylist={syncPlay.clearPlaylist}
              setCurrentPlaylistItem={syncPlay.setCurrentPlaylistItem}
              removePlaylistItem={syncPlay.removePlaylistItem}
            />
          </View>
        </VideoProvider>
      </PlayerProvider>
    </OfflineModeProvider>
  );
}
