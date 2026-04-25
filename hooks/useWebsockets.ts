import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import useRouter from "@/hooks/useAppRouter";
import { useWebSocketContext } from "@/providers/WebSocketProvider";

interface UseWebSocketProps {
  isPlaying: boolean;
  togglePlay: () => void;
  stopPlayback: () => void;
  offline: boolean;
  playPlayback?: () => void;
  pausePlayback?: () => void;

  nextTrack?: () => void;
  previousTrack?: () => void;
  rewindPlayback?: () => void;
  fastForwardPlayback?: () => void;
  seekPlayback?: (positionTicks: number) => void;
  getCurrentPositionTicks?: () => number;
  volumeUp?: () => void;
  volumeDown?: () => void;
  toggleMute?: () => void;
  toggleOsd?: () => void;
  toggleFullscreen?: () => void;
  goHome?: () => void;
  goToSettings?: () => void;
  setAudioStreamIndex?: (index: number) => void;
  setSubtitleStreamIndex?: (index: number) => void;

  moveUp?: () => void;
  moveDown?: () => void;
  moveLeft?: () => void;
  moveRight?: () => void;
  select?: () => void;
  pageUp?: () => void;
  pageDown?: () => void;
  setVolume?: (volume: number) => void;
  setRepeatMode?: (mode: string) => void;
  setShuffleMode?: (mode: string) => void;
  togglePictureInPicture?: () => void;
  takeScreenshot?: () => void;
  sendString?: (text: string) => void;
  sendKey?: (key: string) => void;
  playMediaSource?: (itemIds: string[], startPositionTicks?: number) => void;
  playTrailers?: (itemId: string) => void;
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
};

const readString = (
  value: Record<string, unknown> | null,
  pascalKey: string,
  camelKey: string,
): string | null => {
  if (!value) {
    return null;
  }
  const candidate = value[pascalKey] ?? value[camelKey];
  return typeof candidate === "string" ? candidate : null;
};

const readNumber = (
  value: Record<string, unknown> | null,
  pascalKey: string,
  camelKey: string,
): number | null => {
  if (!value) {
    return null;
  }
  const candidate = value[pascalKey] ?? value[camelKey];
  if (typeof candidate === "number") {
    return Number.isFinite(candidate) ? candidate : null;
  }
  if (typeof candidate === "string") {
    const parsed = Number.parseInt(candidate, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const readDateMs = (
  value: Record<string, unknown> | null,
  pascalKey: string,
  camelKey: string,
): number | null => {
  const candidate = readString(value, pascalKey, camelKey);
  if (!candidate) {
    return null;
  }

  const dateMs = Date.parse(candidate);
  return Number.isNaN(dateMs) ? null : dateMs;
};

const TICKS_PER_MILLISECOND = 10_000;
// Skip seeking on Unpause if position is already close enough (400ms).
// Avoids visible rebuffer stutter when play is pressed.
const SYNC_PLAY_MIN_SEEK_THRESHOLD_TICKS = 400 * TICKS_PER_MILLISECOND;
const SYNC_PLAY_COMMAND_STALE_MS = 2 * 60 * 1000;
const SYNC_PLAY_COMMAND_MIN_DELAY_MS = 25;
const SYNC_PLAY_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const SERVER_TIME_OFFSET_SMOOTHING = 0.2;

export const useWebSocket = ({
  isPlaying,
  togglePlay,
  stopPlayback,
  offline,
  playPlayback,
  pausePlayback,
  nextTrack,
  previousTrack,
  rewindPlayback,
  fastForwardPlayback,
  seekPlayback,
  getCurrentPositionTicks,
  volumeUp,
  volumeDown,
  toggleMute,
  toggleOsd,
  toggleFullscreen,
  goHome,
  goToSettings,
  setAudioStreamIndex,
  setSubtitleStreamIndex,
  moveUp,
  moveDown,
  moveLeft,
  moveRight,
  select,
  pageUp,
  pageDown,
  setVolume,
  setRepeatMode,
  setShuffleMode,
  togglePictureInPicture,
  takeScreenshot,
  sendString,
  sendKey,
  playMediaSource,
  playTrailers,
}: UseWebSocketProps) => {
  const router = useRouter();
  const { lastMessage, clearLastMessage, syncPlayPlaylistItemId } =
    useWebSocketContext();
  const { t } = useTranslation();
  const pendingSyncPlayTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const processedSyncPlayCommandIdsRef = useRef<Map<string, number>>(new Map());
  const serverTimeOffsetMsRef = useRef<number | null>(null);

  // Store all handler props in refs so the message-processing effect
  // doesn't re-run when callback identities change. This prevents
  // the same message being processed multiple times.
  const handlersRef = useRef({
    isPlaying,
    togglePlay,
    stopPlayback,
    playPlayback,
    pausePlayback,
    nextTrack,
    previousTrack,
    rewindPlayback,
    fastForwardPlayback,
    seekPlayback,
    getCurrentPositionTicks,
    volumeUp,
    volumeDown,
    toggleMute,
    toggleOsd,
    toggleFullscreen,
    goHome,
    goToSettings,
    setAudioStreamIndex,
    setSubtitleStreamIndex,
    moveUp,
    moveDown,
    moveLeft,
    moveRight,
    select,
    pageUp,
    pageDown,
    setVolume,
    setRepeatMode,
    setShuffleMode,
    togglePictureInPicture,
    takeScreenshot,
    sendString,
    sendKey,
    playMediaSource,
    playTrailers,
    syncPlayPlaylistItemId,
  });

  useEffect(() => {
    handlersRef.current = {
      isPlaying,
      togglePlay,
      stopPlayback,
      playPlayback,
      pausePlayback,
      nextTrack,
      previousTrack,
      rewindPlayback,
      fastForwardPlayback,
      seekPlayback,
      getCurrentPositionTicks,
      volumeUp,
      volumeDown,
      toggleMute,
      toggleOsd,
      toggleFullscreen,
      goHome,
      goToSettings,
      setAudioStreamIndex,
      setSubtitleStreamIndex,
      moveUp,
      moveDown,
      moveLeft,
      moveRight,
      select,
      pageUp,
      pageDown,
      setVolume,
      setRepeatMode,
      setShuffleMode,
      togglePictureInPicture,
      takeScreenshot,
      sendString,
      sendKey,
      playMediaSource,
      playTrailers,
      syncPlayPlaylistItemId,
    };
  });

  const updateServerTimeOffset = useCallback((emittedAtMs: number | null) => {
    if (emittedAtMs === null) {
      return;
    }

    const now = Date.now();
    const sampleOffsetMs = now - emittedAtMs;
    if (!Number.isFinite(sampleOffsetMs)) {
      return;
    }

    if (serverTimeOffsetMsRef.current === null) {
      serverTimeOffsetMsRef.current = sampleOffsetMs;
      return;
    }

    serverTimeOffsetMsRef.current =
      serverTimeOffsetMsRef.current * (1 - SERVER_TIME_OFFSET_SMOOTHING) +
      sampleOffsetMs * SERVER_TIME_OFFSET_SMOOTHING;
  }, []);

  const toLocalTimeMs = useCallback(
    (remoteMs: number | null): number | null => {
      if (remoteMs === null) {
        return null;
      }

      const offsetMs = serverTimeOffsetMsRef.current;
      if (offsetMs === null) {
        return remoteMs;
      }

      return remoteMs + offsetMs;
    },
    [],
  );

  const runSyncPlayCommand = useCallback(
    (
      command: string | null,
      data: Record<string, unknown> | null,
      localWhenMs: number | null,
    ) => {
      if (!command) {
        return;
      }

      const rawPositionTicks = readNumber(
        data,
        "PositionTicks",
        "positionTicks",
      );
      const commandPlaylistItemId = readString(
        data,
        "PlaylistItemId",
        "playlistItemId",
      );
      const estimatedPositionTicks =
        rawPositionTicks !== null &&
        localWhenMs !== null &&
        command === "Unpause"
          ? rawPositionTicks +
            Math.max(0, Date.now() - localWhenMs) * TICKS_PER_MILLISECOND
          : rawPositionTicks;

      const h = handlersRef.current;

      if (
        command !== "Stop" &&
        commandPlaylistItemId &&
        h.syncPlayPlaylistItemId &&
        commandPlaylistItemId !== h.syncPlayPlaylistItemId
      ) {
        console.log("SyncPlay Command ~ Ignoring playlist mismatch", {
          command,
          commandPlaylistItemId,
          syncPlayPlaylistItemId: h.syncPlayPlaylistItemId,
        });
        return;
      }

      if (command === "Stop") {
        console.log("SyncPlay Command ~ Stop");
        h.stopPlayback();
        router.canGoBack() && router.back();
      } else if (command === "Pause") {
        console.log("SyncPlay Command ~ Pause");
        if (rawPositionTicks !== null) {
          h.seekPlayback?.(rawPositionTicks);
        }
        if (h.pausePlayback) {
          h.pausePlayback();
        } else if (h.isPlaying) {
          h.togglePlay();
        }
      } else if (command === "Unpause") {
        console.log("SyncPlay Command ~ Unpause");
        // Only seek if we're far enough from the target position.
        // Unnecessary seeks cause visible rebuffering stutter.
        if (estimatedPositionTicks !== null) {
          const currentTicks = h.getCurrentPositionTicks?.() ?? null;
          const needsSeek =
            currentTicks === null ||
            Math.abs(estimatedPositionTicks - currentTicks) >
              SYNC_PLAY_MIN_SEEK_THRESHOLD_TICKS;
          if (needsSeek) {
            h.seekPlayback?.(estimatedPositionTicks);
          }
        }
        if (h.playPlayback) {
          h.playPlayback();
        } else if (!h.isPlaying) {
          h.togglePlay();
        }
      } else if (command === "Seek") {
        console.log("SyncPlay Command ~ Seek", {
          positionTicks: rawPositionTicks,
        });
        if (rawPositionTicks !== null) {
          h.seekPlayback?.(rawPositionTicks);
        }
      }
    },
    [router],
  );

  useEffect(() => {
    return () => {
      if (pendingSyncPlayTimeoutRef.current) {
        clearTimeout(pendingSyncPlayTimeoutRef.current);
        pendingSyncPlayTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!lastMessage) return;
    if (offline) return;

    const messageType = lastMessage.MessageType;
    const data = asRecord(lastMessage.Data);
    const command =
      readString(data, "Command", "command") ??
      readString(data, "Name", "name");
    const args = asRecord(data?.Arguments ?? data?.arguments ?? null);

    if (messageType === "SyncPlayGroupUpdate") {
      clearLastMessage();
      return;
    }

    if (messageType === "SyncPlayCommand") {
      const envelope = asRecord(lastMessage);
      const messageId = readString(envelope, "MessageId", "messageId");
      if (messageId) {
        const now = Date.now();
        for (const [
          processedId,
          processedAt,
        ] of processedSyncPlayCommandIdsRef.current) {
          if (now - processedAt > SYNC_PLAY_DEDUP_WINDOW_MS) {
            processedSyncPlayCommandIdsRef.current.delete(processedId);
          }
        }

        if (processedSyncPlayCommandIdsRef.current.has(messageId)) {
          clearLastMessage();
          return;
        }

        processedSyncPlayCommandIdsRef.current.set(messageId, now);
      }

      const whenMs = readDateMs(data, "When", "when");
      const emittedAtMs = readDateMs(data, "EmittedAt", "emittedAt");
      updateServerTimeOffset(emittedAtMs);
      const localWhenMs = toLocalTimeMs(whenMs);
      const localEmittedAtMs = toLocalTimeMs(emittedAtMs);
      const now = Date.now();
      const isStaleFromWhen =
        localWhenMs !== null && now - localWhenMs > SYNC_PLAY_COMMAND_STALE_MS;
      const isStaleFromEmission =
        localEmittedAtMs !== null &&
        now - localEmittedAtMs > SYNC_PLAY_COMMAND_STALE_MS;

      if (isStaleFromWhen || isStaleFromEmission) {
        console.log("SyncPlay Command ~ Ignoring stale command", {
          command,
          whenMs,
          localWhenMs,
          emittedAtMs,
          localEmittedAtMs,
        });
        clearLastMessage();
        return;
      }

      const delayMs = localWhenMs === null ? 0 : Math.max(0, localWhenMs - now);

      if (pendingSyncPlayTimeoutRef.current) {
        clearTimeout(pendingSyncPlayTimeoutRef.current);
        pendingSyncPlayTimeoutRef.current = null;
      }

      if (delayMs >= SYNC_PLAY_COMMAND_MIN_DELAY_MS) {
        pendingSyncPlayTimeoutRef.current = setTimeout(() => {
          runSyncPlayCommand(command, data, localWhenMs);
          pendingSyncPlayTimeoutRef.current = null;
        }, delayMs);
      } else {
        runSyncPlayCommand(command, data, localWhenMs);
      }

      clearLastMessage();
      return;
    }

    // Regular (non-SyncPlay) remote control commands.
    // All handlers accessed via handlersRef to keep deps minimal.
    const h = handlersRef.current;

    if (command === "PlayPause") {
      console.log("Command ~ PlayPause");
      h.togglePlay();
    } else if (command === "Stop") {
      console.log("Command ~ Stop");
      h.stopPlayback();
      router.canGoBack() && router.back();
    } else if (command === "Pause") {
      console.log("Command ~ Pause");
      if (h.isPlaying) {
        h.togglePlay();
      }
    } else if (command === "Unpause") {
      console.log("Command ~ Unpause");
      if (!h.isPlaying) {
        h.togglePlay();
      }
    } else if (command === "NextTrack") {
      console.log("Command ~ NextTrack");
      h.nextTrack?.();
    } else if (command === "PreviousTrack") {
      console.log("Command ~ PreviousTrack");
      h.previousTrack?.();
    } else if (command === "Rewind") {
      console.log("Command ~ Rewind");
      h.rewindPlayback?.();
    } else if (command === "FastForward") {
      console.log("Command ~ FastForward");
      h.fastForwardPlayback?.();
    } else if (command === "Seek") {
      const positionTicks =
        readNumber(args, "SeekPositionTicks", "seekPositionTicks") ??
        readNumber(data, "PositionTicks", "positionTicks");
      console.log("Command ~ Seek", { positionTicks });
      if (positionTicks !== null) {
        h.seekPlayback?.(positionTicks);
      }
    } else if (command === "Back") {
      console.log("Command ~ Back");
      if (router.canGoBack()) {
        router.back();
      }
    } else if (command === "GoHome") {
      console.log("Command ~ GoHome");
      h.goHome ? h.goHome() : router.push("/");
    } else if (command === "GoToSettings") {
      console.log("Command ~ GoToSettings");
      h.goToSettings ? h.goToSettings() : router.push("/settings");
    } else if (command === "VolumeUp") {
      console.log("Command ~ VolumeUp");
      h.volumeUp?.();
    } else if (command === "VolumeDown") {
      console.log("Command ~ VolumeDown");
      h.volumeDown?.();
    } else if (command === "ToggleMute") {
      console.log("Command ~ ToggleMute");
      h.toggleMute?.();
    } else if (command === "ToggleOsd") {
      console.log("Command ~ ToggleOsd");
      h.toggleOsd?.();
    } else if (command === "ToggleFullscreen") {
      console.log("Command ~ ToggleFullscreen");
      h.toggleFullscreen?.();
    } else if (command === "SetAudioStreamIndex") {
      const index = readNumber(args, "Index", "index");
      console.log("Command ~ SetAudioStreamIndex", { index });
      if (index !== null) {
        h.setAudioStreamIndex?.(index);
      }
    } else if (command === "SetSubtitleStreamIndex") {
      const index = readNumber(args, "Index", "index");
      console.log("Command ~ SetSubtitleStreamIndex", { index });
      if (index !== null) {
        h.setSubtitleStreamIndex?.(index);
      }
    } else if (command === "MoveUp") {
      console.log("Command ~ MoveUp");
      h.moveUp?.();
    } else if (command === "MoveDown") {
      console.log("Command ~ MoveDown");
      h.moveDown?.();
    } else if (command === "MoveLeft") {
      console.log("Command ~ MoveLeft");
      h.moveLeft?.();
    } else if (command === "MoveRight") {
      console.log("Command ~ MoveRight");
      h.moveRight?.();
    } else if (command === "Select") {
      console.log("Command ~ Select");
      h.select?.();
    } else if (command === "PageUp") {
      console.log("Command ~ PageUp");
      h.pageUp?.();
    } else if (command === "PageDown") {
      console.log("Command ~ PageDown");
      h.pageDown?.();
    } else if (command === "SetVolume") {
      const volumeValue = readNumber(args, "Volume", "volume");
      console.log("Command ~ SetVolume", { volumeValue });
      if (volumeValue !== null) {
        h.setVolume?.(volumeValue);
      }
    } else if (command === "SetRepeatMode") {
      const mode = readString(args, "Mode", "mode");
      console.log("Command ~ SetRepeatMode", { mode });
      if (mode) {
        h.setRepeatMode?.(mode);
      }
    } else if (command === "SetShuffleMode") {
      const mode = readString(args, "Mode", "mode");
      console.log("Command ~ SetShuffleMode", { mode });
      if (mode) {
        h.setShuffleMode?.(mode);
      }
    } else if (command === "TogglePictureInPicture") {
      console.log("Command ~ TogglePictureInPicture");
      h.togglePictureInPicture?.();
    } else if (command === "TakeScreenshot") {
      console.log("Command ~ TakeScreenshot");
      h.takeScreenshot?.();
    } else if (command === "SendString") {
      const text = readString(args, "Text", "text");
      console.log("Command ~ SendString", { text });
      if (text) {
        h.sendString?.(text);
      }
    } else if (command === "SendKey") {
      const key = readString(args, "Key", "key");
      console.log("Command ~ SendKey", { key });
      if (key) {
        h.sendKey?.(key);
      }
    } else if (command === "PlayMediaSource") {
      const itemIdsStr = readString(args, "ItemIds", "itemIds");
      const startPositionTicks = readNumber(
        args,
        "StartPositionTicks",
        "startPositionTicks",
      );
      console.log("Command ~ PlayMediaSource", {
        itemIdsStr,
        startPositionTicks,
      });
      if (itemIdsStr) {
        const itemIds = itemIdsStr.split(",");
        h.playMediaSource?.(itemIds, startPositionTicks ?? undefined);
      }
    } else if (command === "PlayTrailers") {
      const itemId = readString(args, "ItemId", "itemId");
      console.log("Command ~ PlayTrailers", { itemId });
      if (itemId) {
        h.playTrailers?.(itemId);
      }
    } else if (command === "DisplayMessage") {
      console.log("Command ~ DisplayMessage");
      const title = readString(args, "Header", "header");
      const body = readString(args, "Text", "text");
      Alert.alert(
        t("player.message_from_server", { message: title ?? "" }),
        body ?? undefined,
      );
    }
    clearLastMessage();
  }, [
    lastMessage,
    offline,
    router,
    t,
    clearLastMessage,
    runSyncPlayCommand,
    updateServerTimeOffset,
    toLocalTimeMs,
  ]);
};
