import type { Api } from "@jellyfin/sdk";
import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import { airplay } from "@/utils/profiles/airplay";
import { getStreamUrl } from "./getStreamUrl";

/**
 * Build a playback URL constrained to AVPlayer-compatible formats for AirPlay.
 *
 * Forces the Jellyfin server to use H.264/H.265 + AAC/AC-3 + burn-in subs so the
 * Apple TV can pull the stream directly without MPV in the loop.
 */
export const getAirplayStreamUrl = ({
  api,
  item,
  userId,
  startTimeTicks = 0,
  maxStreamingBitrate,
  playSessionId,
  audioStreamIndex,
  subtitleStreamIndex,
  mediaSourceId,
  deviceId,
}: {
  api: Api | null | undefined;
  item: BaseItemDto | null | undefined;
  userId: string | null | undefined;
  startTimeTicks: number;
  maxStreamingBitrate?: number;
  playSessionId?: string | null;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  mediaSourceId?: string | null;
  deviceId?: string | null;
}) => {
  return getStreamUrl({
    api,
    item,
    userId,
    startTimeTicks,
    maxStreamingBitrate,
    playSessionId,
    deviceProfile: airplay,
    audioStreamIndex,
    subtitleStreamIndex,
    mediaSourceId,
    deviceId,
  });
};
