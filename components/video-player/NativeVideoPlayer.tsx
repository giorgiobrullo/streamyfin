import { useVideoPlayer, VideoView } from "expo-video";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type {
  AudioTrack,
  MpvPlayerViewProps,
  MpvPlayerViewRef,
  VideoSource as MpvVideoSource,
  SubtitleTrack,
  TechnicalInfo,
} from "@/modules/mpv-player";

interface NativeVideoPlayerProps extends MpvPlayerViewProps {
  /**
   * Fires when the AirPlay (external playback) state changes on the underlying
   * AVPlayer. Use this to swap back to the MPV player when the user disconnects
   * the AirPlay route.
   */
  onExternalPlaybackChange?: (isExternal: boolean) => void;
}

const buildExpoSource = (source: MpvVideoSource | undefined) => {
  if (!source?.url) return null;
  return {
    uri: source.url,
    headers: source.headers,
    contentType: source.url.includes(".m3u8") ? ("hls" as const) : undefined,
  };
};

export const NativeVideoPlayer = forwardRef<
  MpvPlayerViewRef,
  NativeVideoPlayerProps
>(
  (
    {
      source,
      style,
      onLoad,
      onPlaybackStateChange,
      onProgress,
      onError,
      onTracksReady,
      onExternalPlaybackChange,
    },
    ref,
  ) => {
    const expoSource = buildExpoSource(source);
    const player = useVideoPlayer(expoSource, (p) => {
      p.allowsExternalPlayback = true;
      p.timeUpdateEventInterval = 0.5;
      p.staysActiveInBackground = true;
    });
    const [contentFit, setContentFit] = useState<"contain" | "cover">(
      "contain",
    );
    const startPositionApplied = useRef(false);
    const hasReportedLoad = useRef(false);
    const tracksReported = useRef(false);

    useEffect(() => {
      // Reset apply flags when source changes
      startPositionApplied.current = false;
      hasReportedLoad.current = false;
      tracksReported.current = false;
    }, [source?.url]);

    useEffect(() => {
      if (!source?.url) return;
      const subs: { remove: () => void }[] = [];

      subs.push(
        player.addListener(
          "timeUpdate",
          ({ currentTime, bufferedPosition }) => {
            const duration = player.duration || 0;
            onProgress?.({
              nativeEvent: {
                position: currentTime,
                duration,
                progress: duration > 0 ? currentTime / duration : 0,
                cacheSeconds: Math.max(0, bufferedPosition - currentTime),
              },
            });
          },
        ),
      );

      subs.push(
        player.addListener("playingChange", ({ isPlaying }) => {
          onPlaybackStateChange?.({
            nativeEvent: {
              isPlaying,
              isPaused: !isPlaying,
              isLoading: false,
              isReadyToSeek: player.duration > 0,
            },
          });
        }),
      );

      subs.push(
        player.addListener("statusChange", ({ status, error }) => {
          if (status === "readyToPlay") {
            // Apply start position once the player is ready
            if (!startPositionApplied.current && source?.startPosition) {
              player.currentTime = source.startPosition;
              startPositionApplied.current = true;
            }
            if (!hasReportedLoad.current) {
              onLoad?.({ nativeEvent: { url: source.url } });
              hasReportedLoad.current = true;
              if (source.autoplay !== false) {
                player.play();
              }
            }
          } else if (status === "error" && error) {
            onError?.({
              nativeEvent: { error: error.message ?? "Unknown error" },
            });
          }
        }),
      );

      subs.push(
        player.addListener("sourceLoad", () => {
          if (!tracksReported.current) {
            onTracksReady?.({ nativeEvent: {} });
            tracksReported.current = true;
          }
        }),
      );

      subs.push(
        player.addListener(
          "isExternalPlaybackActiveChange",
          ({ isExternalPlaybackActive }) => {
            onExternalPlaybackChange?.(isExternalPlaybackActive);
          },
        ),
      );

      return () => {
        for (const s of subs) s.remove();
      };
    }, [
      player,
      source?.url,
      source?.startPosition,
      source?.autoplay,
      onProgress,
      onPlaybackStateChange,
      onLoad,
      onError,
      onTracksReady,
      onExternalPlaybackChange,
    ]);

    const findTrackById = useCallback(
      <T extends { id: string }>(
        list: readonly T[],
        targetId: number,
      ): T | undefined => {
        // expo-video uses string ids; MPV uses numeric. Try both forms.
        return list.find(
          (t) => t.id === String(targetId) || Number(t.id) === targetId,
        );
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        play: async () => {
          player.play();
        },
        pause: async () => {
          player.pause();
        },
        seekTo: async (positionSeconds: number) => {
          player.currentTime = positionSeconds;
        },
        seekBy: async (offsetSeconds: number) => {
          player.seekBy(offsetSeconds);
        },
        setSpeed: async (speed: number) => {
          player.playbackRate = speed;
        },
        getSpeed: async () => player.playbackRate,
        isPaused: async () => !player.playing,
        getCurrentPosition: async () => player.currentTime,
        getDuration: async () => player.duration,

        // MPV PiP is preferred; the native path doesn't expose it imperatively.
        startPictureInPicture: async () => {},
        stopPictureInPicture: async () => {},
        isPictureInPictureSupported: async () => false,
        isPictureInPictureActive: async () => false,

        // Subtitles
        getSubtitleTracks: async (): Promise<SubtitleTrack[]> => {
          return (player.availableSubtitleTracks ?? []).map((t, idx) => ({
            id: Number(t.id ?? idx),
            title: t.label,
            lang: t.language,
            selected: player.subtitleTrack?.id === t.id,
          }));
        },
        setSubtitleTrack: async (trackId: number) => {
          const track = findTrackById(
            player.availableSubtitleTracks ?? [],
            trackId,
          );
          if (track) {
            player.subtitleTrack = track;
          }
        },
        disableSubtitles: async () => {
          player.subtitleTrack = null;
        },
        getCurrentSubtitleTrack: async () => {
          const id = player.subtitleTrack?.id;
          return id != null ? Number(id) : -1;
        },
        addSubtitleFile: async () => {
          // Not supported by AVPlayer / expo-video at runtime
        },

        // MPV-specific subtitle layout — no-ops on the native path
        setSubtitlePosition: async () => {},
        setSubtitleScale: async () => {},
        setSubtitleMarginY: async () => {},
        setSubtitleAlignX: async () => {},
        setSubtitleAlignY: async () => {},
        setSubtitleFontSize: async () => {},

        // Audio
        getAudioTracks: async (): Promise<AudioTrack[]> => {
          return (player.availableAudioTracks ?? []).map((t, idx) => ({
            id: Number(t.id ?? idx),
            title: t.label,
            lang: t.language,
            selected: player.audioTrack?.id === t.id,
          }));
        },
        setAudioTrack: async (trackId: number) => {
          const track = findTrackById(
            player.availableAudioTracks ?? [],
            trackId,
          );
          if (track) {
            player.audioTrack = track;
          }
        },
        getCurrentAudioTrack: async () => {
          const id = player.audioTrack?.id;
          return id != null ? Number(id) : -1;
        },

        setZoomedToFill: async (zoomed: boolean) => {
          setContentFit(zoomed ? "cover" : "contain");
        },
        isZoomedToFill: async () => contentFit === "cover",

        getTechnicalInfo: async (): Promise<TechnicalInfo> => {
          // Limited info available from AVPlayer through expo-video
          return {
            videoWidth: undefined,
            videoHeight: undefined,
            videoCodec: undefined,
            audioCodec: undefined,
            fps: undefined,
            videoBitrate: undefined,
            audioBitrate: undefined,
            cacheSeconds: undefined,
            droppedFrames: undefined,
          };
        },
      }),
      [player, contentFit, findTrackById],
    );

    return (
      <VideoView
        player={player}
        style={style}
        contentFit={contentFit}
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />
    );
  },
);

NativeVideoPlayer.displayName = "NativeVideoPlayer";
