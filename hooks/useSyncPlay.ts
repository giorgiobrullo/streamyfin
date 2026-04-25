import { getItemsApi } from "@jellyfin/sdk/lib/utils/api";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner-native";
import { apiAtom, userAtom } from "@/providers/JellyfinProvider";
import { useWebSocketContext } from "@/providers/WebSocketProvider";
import {
  type SyncPlayGroupInfo,
  type SyncPlayPlayQueueUpdateData,
  type SyncPlayQueueMode,
  type SyncPlayRepeatMode,
  type SyncPlayShuffleMode,
  type SyncPlayStateUpdateData,
  syncPlayCreateGroup,
  syncPlayGetGroup,
  syncPlayJoinGroup,
  syncPlayLeaveGroup,
  syncPlayListGroups,
  syncPlayPing,
  syncPlayQueue,
  syncPlayRemoveFromPlaylist,
  syncPlaySetIgnoreWait,
  syncPlaySetNewQueue,
  syncPlaySetPlaylistItem,
} from "@/services/SyncPlayService";
import { msToTicks } from "@/utils/time";

interface UseSyncPlayOptions {
  currentItemId?: string;
  getCurrentPositionMs?: () => number;
  offline?: boolean;
  onRequirePlaybackItem?: (itemId: string, startPositionTicks?: number) => void;
  /** Suppress toast notifications (use when another useSyncPlay instance already shows them). */
  suppressToasts?: boolean;
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
): string | undefined => {
  const candidate = value?.[pascalKey] ?? value?.[camelKey];
  return typeof candidate === "string" ? candidate : undefined;
};

const readBoolean = (
  value: Record<string, unknown> | null,
  pascalKey: string,
  camelKey: string,
): boolean | undefined => {
  const candidate = value?.[pascalKey] ?? value?.[camelKey];
  return typeof candidate === "boolean" ? candidate : undefined;
};

const readNumber = (
  value: Record<string, unknown> | null,
  pascalKey: string,
  camelKey: string,
): number | undefined => {
  const candidate = value?.[pascalKey] ?? value?.[camelKey];
  return typeof candidate === "number" ? candidate : undefined;
};

const parseIsoDateMs = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const isGroupUnavailableError = (error: unknown): boolean => {
  const errorRecord = asRecord(error);
  const response = asRecord(errorRecord?.response);
  const status = response?.status;

  if (status === 401 || status === 403 || status === 404 || status === 410) {
    return true;
  }

  const responseData = asRecord(response?.data);
  const responseMessage = readString(responseData, "Message", "message");
  const responseErrorCode = readString(responseData, "ErrorCode", "errorCode");
  const errorMessage =
    typeof errorRecord?.message === "string" ? errorRecord.message : undefined;
  const candidateMessage = (
    responseErrorCode ||
    responseMessage ||
    errorMessage ||
    ""
  ).toLowerCase();

  return (
    candidateMessage.includes("groupdoesnotexist") ||
    candidateMessage.includes("group does not exist") ||
    candidateMessage.includes("group not found") ||
    candidateMessage.includes("group is not found") ||
    candidateMessage.includes("notingroup") ||
    candidateMessage.includes("not in group") ||
    candidateMessage.includes("notingroupexception") ||
    candidateMessage.includes("not found")
  );
};

interface ParsedSyncPlayError {
  status?: number;
  statusText?: string;
  errorCode?: string;
  message: string;
  transportCode?: string;
}

const firstNonEmptyString = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return "";
};

const readFirstStringValue = (
  value: unknown,
  depth = 0,
): string | undefined => {
  if (depth > 4) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsedEntry = readFirstStringValue(entry, depth + 1);
      if (parsedEntry) {
        return parsedEntry;
      }
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const parsedEntry = readFirstStringValue(entry, depth + 1);
      if (parsedEntry) {
        return parsedEntry;
      }
    }
  }

  return undefined;
};

const parseSyncPlayError = (error: unknown): ParsedSyncPlayError => {
  const errorRecord = asRecord(error);
  const response = asRecord(errorRecord?.response);
  const responseDataRaw = response?.data;
  const responseData = asRecord(responseDataRaw);

  const status =
    typeof response?.status === "number"
      ? (response.status as number)
      : undefined;
  const statusText =
    typeof response?.statusText === "string"
      ? (response.statusText as string)
      : undefined;
  const errorCode = readString(responseData, "ErrorCode", "errorCode");
  const responseMessage = firstNonEmptyString(
    readString(responseData, "Message", "message"),
    readString(responseData, "Detail", "detail"),
    readString(responseData, "Title", "title"),
    readString(responseData, "Error", "error"),
    readString(responseData, "StatusDescription", "statusDescription"),
    readFirstStringValue(responseData?.Errors ?? responseData?.errors),
    typeof responseDataRaw === "string" ? responseDataRaw : undefined,
  );
  const fallbackMessage =
    typeof errorRecord?.message === "string" ? errorRecord.message : "";
  const transportCode =
    typeof errorRecord?.code === "string" ? errorRecord.code : undefined;

  return {
    status,
    statusText,
    errorCode,
    message: firstNonEmptyString(responseMessage, statusText, fallbackMessage),
    transportCode,
  };
};

const isSyncPlayPermissionError = (error: unknown): boolean => {
  const parsed = parseSyncPlayError(error);
  if (parsed.status === 401 || parsed.status === 403) {
    return true;
  }

  const candidate = `${parsed.errorCode || ""} ${parsed.message}`.toLowerCase();
  return (
    candidate.includes("forbidden") ||
    candidate.includes("unauthorized") ||
    candidate.includes("permission") ||
    candidate.includes("access denied") ||
    candidate.includes("not allowed") ||
    candidate.includes("syncplay access") ||
    candidate.includes("syncplayisdisabled")
  );
};

const isSyncPlaySessionError = (error: unknown): boolean => {
  const parsed = parseSyncPlayError(error);
  const candidate = `${parsed.errorCode || ""} ${parsed.message}`.toLowerCase();
  return (
    candidate.includes("session not found") ||
    candidate.includes("session is null") ||
    candidate.includes("invalid session") ||
    candidate.includes("no session")
  );
};

const isSyncPlayUnsupportedError = (error: unknown): boolean => {
  const parsed = parseSyncPlayError(error);
  if (parsed.status === 405 || parsed.status === 501) {
    return true;
  }

  const candidate = `${parsed.errorCode || ""} ${parsed.message}`.toLowerCase();
  if (
    parsed.status === 404 &&
    !candidate.includes("session not found") &&
    !candidate.includes("invalid session")
  ) {
    return true;
  }
  return (
    candidate.includes("syncplay is unavailable") ||
    candidate.includes("syncplay is disabled") ||
    candidate.includes("syncplay disabled") ||
    candidate.includes("syncplay is not enabled") ||
    candidate.includes("disabled on this server") ||
    candidate.includes("not implemented") ||
    candidate.includes("no route") ||
    candidate.includes("endpoint not found")
  );
};

const isSyncPlayNetworkError = (error: unknown): boolean => {
  const parsed = parseSyncPlayError(error);
  if (!parsed.status && !parsed.errorCode && !parsed.message) {
    return true;
  }
  return (
    parsed.transportCode === "ERR_NETWORK" ||
    parsed.transportCode === "ECONNABORTED"
  );
};

const toSyncPlayErrorMessage = (
  error: unknown,
  fallbackMessage: string,
): string => {
  if (isSyncPlayPermissionError(error)) {
    return "SyncPlay permission denied. Ask your Jellyfin admin to enable SyncPlay access for this account.";
  }

  if (isSyncPlaySessionError(error)) {
    return "SyncPlay session is not available for this device. Try reconnecting or sign out and sign back in.";
  }

  if (isSyncPlayUnsupportedError(error)) {
    return "SyncPlay is unavailable on this Jellyfin server.";
  }

  if (isSyncPlayNetworkError(error)) {
    return "Cannot reach the Jellyfin server right now.";
  }

  const parsed = parseSyncPlayError(error);
  if (parsed.message) {
    const statusPrefix = parsed.status ? ` (${parsed.status})` : "";
    return `${fallbackMessage}${statusPrefix}: ${parsed.message}`;
  }

  return fallbackMessage;
};

const parseGroupInfo = (value: unknown): SyncPlayGroupInfo | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const participantsRaw = record.Participants ?? record.participants;
  const participants = Array.isArray(participantsRaw)
    ? participantsRaw.filter((participant): participant is string => {
        return typeof participant === "string";
      })
    : undefined;

  return {
    GroupId: readString(record, "GroupId", "groupId"),
    GroupName: readString(record, "GroupName", "groupName"),
    State: readString(record, "State", "state") as SyncPlayGroupInfo["State"],
    Participants: participants,
    LastUpdatedAt: readString(record, "LastUpdatedAt", "lastUpdatedAt"),
  };
};

const parseStateUpdate = (value: unknown): SyncPlayStateUpdateData | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    State: readString(
      record,
      "State",
      "state",
    ) as SyncPlayStateUpdateData["State"],
    Reason: readString(
      record,
      "Reason",
      "reason",
    ) as SyncPlayStateUpdateData["Reason"],
  };
};

const parsePlayQueueUpdate = (
  value: unknown,
): SyncPlayPlayQueueUpdateData | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const playlistRaw = record.Playlist ?? record.playlist;
  const playlist = Array.isArray(playlistRaw)
    ? playlistRaw.map((playlistItem) => {
        const item = asRecord(playlistItem);
        return {
          ItemId: readString(item, "ItemId", "itemId"),
          PlaylistItemId: readString(item, "PlaylistItemId", "playlistItemId"),
        };
      })
    : undefined;

  return {
    Reason: readString(record, "Reason", "reason") as
      | SyncPlayPlayQueueUpdateData["Reason"]
      | undefined,
    LastUpdate: readString(record, "LastUpdate", "lastUpdate"),
    Playlist: playlist,
    PlayingItemIndex: readNumber(
      record,
      "PlayingItemIndex",
      "playingItemIndex",
    ),
    StartPositionTicks: readNumber(
      record,
      "StartPositionTicks",
      "startPositionTicks",
    ),
    IsPlaying: readBoolean(record, "IsPlaying", "isPlaying"),
    ShuffleMode: readString(record, "ShuffleMode", "shuffleMode") as
      | SyncPlayShuffleMode
      | undefined,
    RepeatMode: readString(record, "RepeatMode", "repeatMode") as
      | SyncPlayRepeatMode
      | undefined,
  };
};

export const useSyncPlay = ({
  currentItemId,
  getCurrentPositionMs,
  offline = false,
  onRequirePlaybackItem,
  suppressToasts = false,
}: UseSyncPlayOptions) => {
  const api = useAtomValue(apiAtom);
  const user = useAtomValue(userAtom);
  const {
    isInSyncPlayGroup,
    isConnected,
    syncPlayGroupId,
    lastSyncPlayGroupUpdateMessage,
  } = useWebSocketContext();

  const [groups, setGroups] = useState<SyncPlayGroupInfo[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupInfo, setGroupInfo] = useState<SyncPlayGroupInfo | null>(null);
  const [queueUpdate, setQueueUpdate] =
    useState<SyncPlayPlayQueueUpdateData | null>(null);
  const [stateUpdate, setStateUpdate] =
    useState<SyncPlayStateUpdateData | null>(null);
  const previousGroupStateRef = useRef<string | null>(null);
  const [ignoreWait, setIgnoreWaitState] = useState(false);
  const [manuallyLeftGroup, setManuallyLeftGroup] = useState(false);
  const [queueItemNames, setQueueItemNames] = useState<Record<string, string>>(
    {},
  );
  const lastRoutedItemIdRef = useRef<string | null>(null);
  const lastQueueUpdateAtRef = useRef(0);
  const pingInFlightRef = useRef(false);
  const measuredPingMsRef = useRef(0);
  const activeGroupIdRef = useRef<string | null>(syncPlayGroupId);
  const currentGroupRequestIdRef = useRef(0);
  const previousSyncPlayGroupIdRef = useRef<string | null>(syncPlayGroupId);
  const wasSocketConnectedRef = useRef(isConnected);

  const inGroup = Boolean(
    !manuallyLeftGroup &&
      ((isInSyncPlayGroup && syncPlayGroupId) || groupInfo?.GroupId),
  );

  const syncPlayAccess = user?.Policy?.SyncPlayAccess;
  const canJoinSyncPlayGroups = useMemo(() => {
    if (typeof syncPlayAccess !== "string") {
      return true;
    }
    return (
      syncPlayAccess === "JoinGroups" ||
      syncPlayAccess === "CreateAndJoinGroups"
    );
  }, [syncPlayAccess]);
  const canCreateSyncPlayGroups =
    typeof syncPlayAccess !== "string" ||
    syncPlayAccess === "CreateAndJoinGroups";

  const clearSyncPlayState = useCallback(() => {
    setGroupInfo(null);
    setQueueUpdate(null);
    setStateUpdate(null);
    setIgnoreWaitState(false);
    lastRoutedItemIdRef.current = null;
    lastQueueUpdateAtRef.current = 0;
  }, []);

  useEffect(() => {
    activeGroupIdRef.current = syncPlayGroupId ?? groupInfo?.GroupId ?? null;
  }, [syncPlayGroupId, groupInfo?.GroupId]);

  useEffect(() => {
    const previousGroupId = previousSyncPlayGroupIdRef.current;
    if (previousGroupId !== syncPlayGroupId) {
      setQueueUpdate(null);
      setStateUpdate(null);
      lastQueueUpdateAtRef.current = 0;
      lastRoutedItemIdRef.current = null;
    }
    previousSyncPlayGroupIdRef.current = syncPlayGroupId;
  }, [syncPlayGroupId]);

  const withAction = useCallback(
    async (action: () => Promise<void>) => {
      if (!api || offline) {
        return;
      }

      try {
        setActionLoading(true);
        setError(null);
        await action();
      } catch (actionError) {
        console.warn("SyncPlay action failed:", actionError);
        setError(
          toSyncPlayErrorMessage(actionError, "SyncPlay request failed"),
        );
      } finally {
        setActionLoading(false);
      }
    },
    [api, offline],
  );

  const refreshGroups = useCallback(async () => {
    if (!api || offline) {
      return;
    }
    if (!canJoinSyncPlayGroups) {
      setGroups([]);
      setError(
        "SyncPlay is disabled for this account. Ask your Jellyfin admin to allow SyncPlay access.",
      );
      return;
    }

    setGroupsLoading(true);
    try {
      const result = await syncPlayListGroups(api);
      setGroups(result);
      setError(null);
    } catch (loadError) {
      console.warn("Failed to load SyncPlay groups:", loadError);
      setGroups([]);
      setError(
        toSyncPlayErrorMessage(loadError, "Failed to load SyncPlay groups"),
      );
    } finally {
      setGroupsLoading(false);
    }
  }, [api, offline, canJoinSyncPlayGroups]);

  const refreshCurrentGroup = useCallback(
    async (groupIdOverride?: string) => {
      if (!api || offline) {
        return;
      }

      const requestGroupId =
        groupIdOverride ?? syncPlayGroupId ?? activeGroupIdRef.current;
      if (!requestGroupId) {
        return;
      }

      const requestId = currentGroupRequestIdRef.current + 1;
      currentGroupRequestIdRef.current = requestId;

      try {
        const result = await syncPlayGetGroup(api, requestGroupId);
        if (currentGroupRequestIdRef.current !== requestId) {
          return;
        }

        const activeGroupId = activeGroupIdRef.current;
        if (activeGroupId && activeGroupId !== requestGroupId) {
          return;
        }

        setManuallyLeftGroup(false);
        setGroupInfo(result);
        setError(null);
      } catch (loadError) {
        if (currentGroupRequestIdRef.current !== requestId) {
          return;
        }

        const activeGroupId = activeGroupIdRef.current;
        if (activeGroupId && activeGroupId !== requestGroupId) {
          return;
        }

        if (isGroupUnavailableError(loadError)) {
          setManuallyLeftGroup(true);
          clearSyncPlayState();
          setError(null);
          await refreshGroups();
          return;
        }
        console.warn("Failed to load SyncPlay group:", loadError);
        if (
          isSyncPlayPermissionError(loadError) ||
          isSyncPlayUnsupportedError(loadError) ||
          isSyncPlaySessionError(loadError)
        ) {
          clearSyncPlayState();
        }
        setError(
          toSyncPlayErrorMessage(loadError, "Failed to load SyncPlay group"),
        );
      }
    },
    [api, offline, syncPlayGroupId, clearSyncPlayState, refreshGroups],
  );

  const setNewQueueFromCurrentItem = useCallback(async () => {
    if (!api || offline || !currentItemId) {
      return;
    }

    const currentPositionMs = getCurrentPositionMs?.() ?? 0;

    await syncPlaySetNewQueue(api, {
      PlayingQueue: [currentItemId],
      PlayingItemPosition: 0,
      StartPositionTicks: msToTicks(currentPositionMs),
    });
  }, [api, offline, currentItemId, getCurrentPositionMs]);

  const createGroup = useCallback(
    async (groupName?: string) => {
      await withAction(async () => {
        if (!api) return;
        if (!canCreateSyncPlayGroups) {
          setError(
            "This account can join groups but cannot create them. Ask your Jellyfin admin to allow group creation.",
          );
          return;
        }

        const resolvedName = groupName || `${user?.Name ?? "User"}'s group`;
        const createdGroup = await syncPlayCreateGroup(api, {
          GroupName: resolvedName,
        });
        if (createdGroup?.GroupId) {
          setManuallyLeftGroup(false);
          try {
            await syncPlayJoinGroup(api, { GroupId: createdGroup.GroupId });
          } catch {
            // Some Jellyfin versions auto-join on group creation.
          }
          setGroupInfo(createdGroup);
          await refreshCurrentGroup(createdGroup.GroupId);
        }
        if (currentItemId) {
          await setNewQueueFromCurrentItem();
        }
        await refreshGroups();
      });
    },
    [
      withAction,
      api,
      canCreateSyncPlayGroups,
      currentItemId,
      setNewQueueFromCurrentItem,
      refreshGroups,
      refreshCurrentGroup,
    ],
  );

  const joinGroup = useCallback(
    async (groupId: string) => {
      await withAction(async () => {
        if (!api) return;
        setManuallyLeftGroup(false);
        await syncPlayJoinGroup(api, { GroupId: groupId });
        setGroupInfo((previous) => ({
          ...previous,
          GroupId: groupId,
        }));
        await refreshCurrentGroup(groupId);
        await refreshGroups();
        setError(null);
      });
    },
    [withAction, api, refreshGroups, refreshCurrentGroup],
  );

  const leaveGroup = useCallback(async () => {
    await withAction(async () => {
      if (!api) return;
      await syncPlayLeaveGroup(api);
      setManuallyLeftGroup(true);
      clearSyncPlayState();
      await refreshGroups();
    });
  }, [withAction, api, clearSyncPlayState, refreshGroups]);

  const toggleIgnoreWait = useCallback(async () => {
    await withAction(async () => {
      if (!api) return;
      const newValue = !ignoreWait;
      await syncPlaySetIgnoreWait(api, { IgnoreWait: newValue });
      setIgnoreWaitState(newValue);
    });
  }, [withAction, api, ignoreWait]);

  const queueCurrentItem = useCallback(
    async (mode: SyncPlayQueueMode) => {
      if (!currentItemId) {
        return;
      }

      await withAction(async () => {
        if (!api) return;
        await syncPlayQueue(api, {
          ItemIds: [currentItemId],
          Mode: mode,
        });
      });
    },
    [currentItemId, withAction, api],
  );

  const clearPlaylist = useCallback(async () => {
    await withAction(async () => {
      if (!api) return;
      await syncPlayRemoveFromPlaylist(api, {
        ClearPlaylist: true,
        ClearPlayingItem: false,
      });
    });
  }, [withAction, api]);

  const setCurrentPlaylistItem = useCallback(
    async (playlistItemId: string) => {
      await withAction(async () => {
        if (!api) return;
        await syncPlaySetPlaylistItem(api, { PlaylistItemId: playlistItemId });
      });
    },
    [withAction, api],
  );

  const removePlaylistItem = useCallback(
    async (playlistItemId: string) => {
      await withAction(async () => {
        if (!api) return;
        await syncPlayRemoveFromPlaylist(api, {
          PlaylistItemIds: [playlistItemId],
          ClearPlaylist: false,
          ClearPlayingItem: false,
        });
      });
    },
    [withAction, api],
  );

  useEffect(() => {
    if (!inGroup || !api || offline) {
      return;
    }

    const reportPing = async () => {
      if (pingInFlightRef.current) {
        return;
      }

      pingInFlightRef.current = true;
      const pingToReport = Math.round(measuredPingMsRef.current);
      const requestStart = Date.now();
      try {
        await syncPlayPing(api, { Ping: pingToReport });
        measuredPingMsRef.current = Date.now() - requestStart;
      } catch (error) {
        console.warn("Failed to ping SyncPlay group:", error);
      } finally {
        pingInFlightRef.current = false;
      }
    };

    void reportPing();
    const interval = setInterval(() => {
      void reportPing();
    }, 15000);

    return () => {
      clearInterval(interval);
    };
  }, [inGroup, api, offline]);

  useEffect(() => {
    if (!lastSyncPlayGroupUpdateMessage) {
      return;
    }

    const updateData = asRecord(lastSyncPlayGroupUpdateMessage.Data);
    const type = readString(updateData, "Type", "type");
    const updateGroupId = readString(updateData, "GroupId", "groupId");
    const activeGroupId = syncPlayGroupId ?? groupInfo?.GroupId;
    const payload = updateData?.Data ?? updateData?.data;

    if (
      updateGroupId &&
      activeGroupId &&
      updateGroupId !== activeGroupId &&
      type !== "GroupJoined"
    ) {
      return;
    }

    if (
      type === "GroupLeft" ||
      type === "NotInGroup" ||
      type === "GroupDoesNotExist" ||
      type === "LibraryAccessDenied"
    ) {
      setManuallyLeftGroup(true);
      clearSyncPlayState();
      return;
    }

    if (type === "GroupJoined") {
      const parsed = parseGroupInfo(payload);
      setManuallyLeftGroup(false);
      if (parsed) {
        setGroupInfo(parsed);
      } else if (updateGroupId) {
        setGroupInfo((previous) => ({
          ...previous,
          GroupId: updateGroupId,
        }));
      }
      return;
    }

    if (type === "UserJoined") {
      const username = typeof payload === "string" ? payload : null;
      if (username && !suppressToasts) {
        toast.info(`${username} joined the group`);
      }
      void refreshCurrentGroup();
      return;
    }

    if (type === "UserLeft") {
      const username = typeof payload === "string" ? payload : null;
      if (username && !suppressToasts) {
        toast.info(`${username} left the group`);
      }
      void refreshCurrentGroup();
      return;
    }

    if (type === "StateUpdate") {
      const parsed = parseStateUpdate(payload);
      if (parsed) {
        const prevState = previousGroupStateRef.current;

        if (!suppressToasts) {
          // Only toast for buffering-related transitions, not manual play/pause.
          if (
            parsed.State === "Waiting" &&
            prevState !== "Waiting" &&
            parsed.Reason === "Buffer"
          ) {
            toast.info("Waiting for everyone to be ready...");
          }

          if (
            prevState === "Waiting" &&
            parsed.State === "Playing" &&
            parsed.Reason === "Ready"
          ) {
            toast.info("Everyone's ready, resuming playback");
          }
        }

        previousGroupStateRef.current = parsed.State ?? null;
        setStateUpdate(parsed);
        setGroupInfo((previous) => {
          if (!previous) {
            return previous;
          }
          return { ...previous, State: parsed.State };
        });
      }
      return;
    }

    if (type === "PlayQueue") {
      const parsed = parsePlayQueueUpdate(payload);
      if (parsed) {
        const lastUpdateMs = parseIsoDateMs(parsed.LastUpdate);
        if (
          lastUpdateMs !== null &&
          lastQueueUpdateAtRef.current > 0 &&
          lastUpdateMs <= lastQueueUpdateAtRef.current
        ) {
          return;
        }

        if (lastUpdateMs !== null) {
          lastQueueUpdateAtRef.current = lastUpdateMs;
        }
        setQueueUpdate(parsed);
      }
    }
  }, [
    lastSyncPlayGroupUpdateMessage,
    clearSyncPlayState,
    syncPlayGroupId,
    groupInfo?.GroupId,
    refreshCurrentGroup,
  ]);

  useEffect(() => {
    if (!inGroup) {
      clearSyncPlayState();
      return;
    }

    void refreshCurrentGroup();
  }, [inGroup, refreshCurrentGroup, clearSyncPlayState]);

  useEffect(() => {
    const wasConnected = wasSocketConnectedRef.current;
    if (!wasConnected && isConnected && inGroup) {
      void refreshGroups();
      void refreshCurrentGroup();
    }
    wasSocketConnectedRef.current = isConnected;
  }, [isConnected, inGroup, refreshGroups, refreshCurrentGroup]);

  useEffect(() => {
    if (!inGroup || !onRequirePlaybackItem || !queueUpdate) {
      return;
    }

    const currentIndex = queueUpdate.PlayingItemIndex;
    const playlist = queueUpdate.Playlist;

    if (
      typeof currentIndex !== "number" ||
      !Array.isArray(playlist) ||
      currentIndex < 0 ||
      currentIndex >= playlist.length
    ) {
      return;
    }

    const currentQueueItem = playlist[currentIndex];
    const targetItemId = currentQueueItem?.ItemId;
    if (!targetItemId) {
      return;
    }

    if (targetItemId === currentItemId) {
      lastRoutedItemIdRef.current = targetItemId;
      return;
    }

    if (lastRoutedItemIdRef.current === targetItemId) {
      return;
    }

    lastRoutedItemIdRef.current = targetItemId;
    onRequirePlaybackItem(targetItemId, queueUpdate.StartPositionTicks);
  }, [inGroup, onRequirePlaybackItem, queueUpdate, currentItemId]);

  // Resolve item names for queue items
  useEffect(() => {
    const playlist = queueUpdate?.Playlist;
    if (!api || !user?.Id || !playlist || playlist.length === 0) {
      return;
    }

    const unresolvedIds = playlist
      .map((item) => item.ItemId)
      .filter((id): id is string => Boolean(id))
      .filter((id) => !queueItemNames[id]);

    if (unresolvedIds.length === 0) {
      return;
    }

    const fetchNames = async () => {
      try {
        const response = await getItemsApi(api).getItems({
          userId: user.Id,
          ids: unresolvedIds,
          fields: ["PrimaryImageAspectRatio"],
        });
        const items = response.data.Items ?? [];
        const newNames: Record<string, string> = {};
        for (const item of items) {
          if (item.Id && item.Name) {
            // For episodes, show "S01E02 - Episode Name"
            if (
              item.Type === "Episode" &&
              item.ParentIndexNumber != null &&
              item.IndexNumber != null
            ) {
              newNames[item.Id] =
                `S${String(item.ParentIndexNumber).padStart(2, "0")}E${String(item.IndexNumber).padStart(2, "0")} - ${item.Name}`;
            } else {
              newNames[item.Id] = item.Name;
            }
          }
        }
        if (Object.keys(newNames).length > 0) {
          setQueueItemNames((prev) => ({ ...prev, ...newNames }));
        }
      } catch {
        // Silently fail — items will just show as "Unknown"
      }
    };
    void fetchNames();
  }, [api, user?.Id, queueUpdate?.Playlist]);

  return {
    inGroup,
    groupId: syncPlayGroupId,
    groupInfo,
    queueUpdate,
    stateUpdate,
    queueItemNames,
    groups,
    groupsLoading,
    actionLoading,
    error,
    ignoreWait,
    refreshGroups,
    refreshCurrentGroup,
    createGroup,
    joinGroup,
    leaveGroup,
    toggleIgnoreWait,
    setNewQueueFromCurrentItem: () => withAction(setNewQueueFromCurrentItem),
    queueCurrentItem,
    clearPlaylist,
    setCurrentPlaylistItem,
    removePlaylistItem,
  };
};
