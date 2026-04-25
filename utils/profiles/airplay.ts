import type { DeviceProfile } from "@jellyfin/sdk/lib/generated-client/models";

/**
 * Device profile used when handing playback off to AVPlayer for AirPlay.
 *
 * Constrained to the codecs/containers AVPlayer + Apple TV reliably play
 * (H.264, HEVC, AAC/AC-3/EAC-3, MP4/HLS) and forces subtitle burn-in via the
 * server, since AVPlayer can't render PGS bitmap or styled ASS subs.
 */
export const airplay: DeviceProfile = {
  Name: "AirPlay (AVPlayer) Profile",
  MaxStreamingBitrate: 40000000, // 40 Mbps — Apple TV can handle 4K HDR
  MaxStaticBitrate: 40000000,
  MusicStreamingTranscodingBitrate: 384000,
  CodecProfiles: [
    { Type: "Video", Codec: "h264,hevc" },
    { Type: "Audio", Codec: "aac,ac3,eac3,mp3" },
  ],
  ContainerProfiles: [],
  DirectPlayProfiles: [
    {
      Container: "mp4,m4v,mov",
      Type: "Video",
      VideoCodec: "h264,hevc",
      AudioCodec: "aac,ac3,eac3,mp3",
    },
    { Container: "mp3", Type: "Audio" },
    { Container: "aac", Type: "Audio" },
    { Container: "m4a", Type: "Audio" },
    { Container: "flac", Type: "Audio" },
    { Container: "wav", Type: "Audio" },
  ],
  TranscodingProfiles: [
    {
      Container: "ts",
      Type: "Video",
      VideoCodec: "h264,hevc",
      AudioCodec: "aac,ac3,eac3",
      Protocol: "hls",
      Context: "Streaming",
      MaxAudioChannels: "6",
      MinSegments: 2,
      BreakOnNonKeyFrames: true,
    },
    {
      Container: "mp3",
      Type: "Audio",
      AudioCodec: "mp3",
      Protocol: "http",
      Context: "Streaming",
      MaxAudioChannels: "2",
    },
    {
      Container: "aac",
      Type: "Audio",
      AudioCodec: "aac",
      Protocol: "http",
      Context: "Streaming",
      MaxAudioChannels: "2",
    },
  ],
  SubtitleProfiles: [
    // AVPlayer only handles a few text-based formats well. Force everything
    // to burn-in via the server so styled ASS / bitmap PGS subs render.
    { Format: "vtt", Method: "External" },
    { Format: "srt", Method: "External" },
    { Format: "ass", Method: "Encode" },
    { Format: "ssa", Method: "Encode" },
    { Format: "pgs", Method: "Encode" },
    { Format: "pgssub", Method: "Encode" },
    { Format: "dvbsub", Method: "Encode" },
    { Format: "dvdsub", Method: "Encode" },
    { Format: "sub", Method: "Encode" },
    { Format: "vobsub", Method: "Encode" },
  ],
};
