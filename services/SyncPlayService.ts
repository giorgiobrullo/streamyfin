import type { Api } from "@jellyfin/sdk";

export type SyncPlayGroupState = "Idle" | "Waiting" | "Paused" | "Playing";
export type SyncPlayQueueMode = "Queue" | "QueueNext";
export type SyncPlayRepeatMode = "RepeatOne" | "RepeatAll" | "RepeatNone";
export type SyncPlayShuffleMode = "Sorted" | "Shuffle";

export type SyncPlayPlaybackRequestType =
  | "Play"
  | "SetPlaylistItem"
  | "RemoveFromPlaylist"
  | "MovePlaylistItem"
  | "Queue"
  | "Unpause"
  | "Pause"
  | "Stop"
  | "Seek"
  | "Buffer"
  | "Ready"
  | "NextItem"
  | "PreviousItem"
  | "SetRepeatMode"
  | "SetShuffleMode"
  | "Ping"
  | "IgnoreWait";

export type SyncPlaySendCommandType = "Unpause" | "Pause" | "Stop" | "Seek";

export type SyncPlayGroupUpdateType =
  | "UserJoined"
  | "UserLeft"
  | "GroupJoined"
  | "GroupLeft"
  | "StateUpdate"
  | "PlayQueue"
  | "NotInGroup"
  | "GroupDoesNotExist"
  | "LibraryAccessDenied";

export interface SyncPlayJoinGroupRequest {
  GroupId: string;
}

export interface SyncPlayNewGroupRequest {
  GroupName?: string;
}

export interface SyncPlayPlayerStateRequest {
  When?: string;
  PositionTicks?: number;
  IsPlaying?: boolean;
  PlaylistItemId?: string;
}

export interface SyncPlaySeekRequest {
  PositionTicks: number;
}

export interface SyncPlayPingRequest {
  Ping: number;
}

export interface SyncPlayMovePlaylistItemRequest {
  PlaylistItemId: string;
  NewIndex: number;
}

export interface SyncPlaySetQueueRequest {
  PlayingQueue: string[];
  PlayingItemPosition: number;
  StartPositionTicks?: number;
}

export interface SyncPlayQueueRequest {
  ItemIds: string[];
  Mode: SyncPlayQueueMode;
}

export interface SyncPlaySetPlaylistItemRequest {
  PlaylistItemId: string;
}

export interface SyncPlaySetRepeatModeRequest {
  Mode: SyncPlayRepeatMode;
}

export interface SyncPlaySetShuffleModeRequest {
  Mode: SyncPlayShuffleMode;
}

export interface SyncPlayRemoveFromPlaylistRequest {
  PlaylistItemIds?: string[];
  ClearPlaylist?: boolean;
  ClearPlayingItem?: boolean;
}

export interface SyncPlaySetIgnoreWaitRequest {
  IgnoreWait: boolean;
}

export interface SyncPlayGroupInfo {
  GroupId?: string;
  GroupName?: string;
  State?: SyncPlayGroupState;
  Participants?: string[];
  LastUpdatedAt?: string;
}

export interface SyncPlayCommandData {
  GroupId?: string;
  PlaylistItemId?: string;
  When?: string;
  PositionTicks?: number | null;
  Command?: SyncPlaySendCommandType;
  EmittedAt?: string;
}

export interface SyncPlayCommandMessage {
  MessageType: "SyncPlayCommand";
  MessageId?: string;
  Data?: SyncPlayCommandData;
}

export interface SyncPlayQueueItem {
  ItemId?: string;
  PlaylistItemId?: string;
}

export interface SyncPlayPlayQueueUpdateData {
  Reason?:
    | "NewPlaylist"
    | "SetCurrentItem"
    | "RemoveItems"
    | "MoveItem"
    | "Queue"
    | "QueueNext"
    | "NextItem"
    | "PreviousItem"
    | "RepeatMode"
    | "ShuffleMode";
  LastUpdate?: string;
  Playlist?: SyncPlayQueueItem[];
  PlayingItemIndex?: number;
  StartPositionTicks?: number;
  IsPlaying?: boolean;
  ShuffleMode?: SyncPlayShuffleMode;
  RepeatMode?: SyncPlayRepeatMode;
}

export interface SyncPlayStateUpdateData {
  State?: SyncPlayGroupState;
  Reason?: SyncPlayPlaybackRequestType;
}

export interface SyncPlayGroupUpdateData {
  GroupId?: string;
  Type?: SyncPlayGroupUpdateType;
  Data?: SyncPlayStateUpdateData | SyncPlayPlayQueueUpdateData | string | null;
}

export interface SyncPlayGroupUpdateMessage {
  MessageType: "SyncPlayGroupUpdate";
  MessageId?: string;
  Data?: SyncPlayGroupUpdateData;
}

interface MessageEnvelope {
  MessageType?: unknown;
}

const postSyncPlay = async (api: Api, path: string, body?: unknown) => {
  if (body !== undefined) {
    await api.post(path, body);
    return;
  }
  await api.post(path, null);
};

export const isSyncPlayCommandMessage = (
  message: MessageEnvelope | null | undefined,
): message is SyncPlayCommandMessage =>
  message?.MessageType === "SyncPlayCommand";

export const isSyncPlayGroupUpdateMessage = (
  message: MessageEnvelope | null | undefined,
): message is SyncPlayGroupUpdateMessage =>
  message?.MessageType === "SyncPlayGroupUpdate";

export const syncPlayListGroups = async (
  api: Api,
): Promise<SyncPlayGroupInfo[]> => {
  const response = await api.get<SyncPlayGroupInfo[]>("/SyncPlay/List");
  return response.data ?? [];
};

export const syncPlayGetGroup = async (
  api: Api,
  groupId: string,
): Promise<SyncPlayGroupInfo> => {
  const response = await api.get<SyncPlayGroupInfo>(`/SyncPlay/${groupId}`);
  return response.data;
};

export const syncPlayCreateGroup = async (
  api: Api,
  request: SyncPlayNewGroupRequest,
): Promise<SyncPlayGroupInfo | null> => {
  const response = await api.post<SyncPlayGroupInfo, SyncPlayNewGroupRequest>(
    "/SyncPlay/New",
    request,
  );
  return response.data ?? null;
};

export const syncPlayJoinGroup = async (
  api: Api,
  request: SyncPlayJoinGroupRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Join", request);
};

export const syncPlayLeaveGroup = async (api: Api): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Leave");
};

export const syncPlayReady = async (
  api: Api,
  request: SyncPlayPlayerStateRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Ready", request);
};

export const syncPlayBuffering = async (
  api: Api,
  request: SyncPlayPlayerStateRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Buffering", request);
};

export const syncPlayPing = async (
  api: Api,
  request: SyncPlayPingRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Ping", request);
};

export const syncPlaySeek = async (
  api: Api,
  request: SyncPlaySeekRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Seek", request);
};

export const syncPlayPause = async (api: Api): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Pause");
};

export const syncPlayUnpause = async (api: Api): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Unpause");
};

export const syncPlayPlay = async (api: Api): Promise<void> => {
  await syncPlayUnpause(api);
};

export const syncPlayStop = async (api: Api): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Stop");
};

export const syncPlayMovePlaylistItem = async (
  api: Api,
  request: SyncPlayMovePlaylistItemRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/MovePlaylistItem", request);
};

export const syncPlayNextItem = async (
  api: Api,
  request?: SyncPlaySetPlaylistItemRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/NextItem", request);
};

export const syncPlayPreviousItem = async (
  api: Api,
  request?: SyncPlaySetPlaylistItemRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/PreviousItem", request);
};

export const syncPlayQueue = async (
  api: Api,
  request: SyncPlayQueueRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/Queue", request);
};

export const syncPlaySetNewQueue = async (
  api: Api,
  request: SyncPlaySetQueueRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/SetNewQueue", request);
};

export const syncPlaySetPlaylistItem = async (
  api: Api,
  request: SyncPlaySetPlaylistItemRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/SetPlaylistItem", request);
};

export const syncPlayRemoveFromPlaylist = async (
  api: Api,
  request: SyncPlayRemoveFromPlaylistRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/RemoveFromPlaylist", request);
};

export const syncPlaySetIgnoreWait = async (
  api: Api,
  request: SyncPlaySetIgnoreWaitRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/SetIgnoreWait", request);
};

export const syncPlaySetRepeatMode = async (
  api: Api,
  request: SyncPlaySetRepeatModeRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/SetRepeatMode", request);
};

export const syncPlaySetShuffleMode = async (
  api: Api,
  request: SyncPlaySetShuffleModeRequest,
): Promise<void> => {
  await postSyncPlay(api, "/SyncPlay/SetShuffleMode", request);
};
