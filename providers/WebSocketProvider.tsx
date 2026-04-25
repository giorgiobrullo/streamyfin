import { getSessionApi } from "@jellyfin/sdk/lib/utils/api";
import { useAtomValue } from "jotai";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import useRouter from "@/hooks/useAppRouter";
import { apiAtom, getOrSetDeviceId } from "@/providers/JellyfinProvider";
import { useNetworkStatus } from "@/providers/NetworkStatusProvider";
import {
  isSyncPlayCommandMessage,
  isSyncPlayGroupUpdateMessage,
  type SyncPlayCommandMessage,
  type SyncPlayGroupUpdateMessage,
  type SyncPlayGroupUpdateType,
} from "@/services/SyncPlayService";

interface WebSocketMessage {
  MessageType: string;
  Data: unknown;
  // Add other fields as needed
}

interface WebSocketProviderProps {
  children: ReactNode;
}

interface WebSocketContextType {
  ws: WebSocket | null;
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  lastSyncPlayCommandMessage: SyncPlayCommandMessage | null;
  lastSyncPlayGroupUpdateMessage: SyncPlayGroupUpdateMessage | null;
  syncPlayGroupId: string | null;
  syncPlayPlaylistItemId: string | null;
  syncPlayCurrentItemId: string | null;
  syncPlayCurrentPositionTicks: number | null;
  syncPlayCurrentPositionCapturedAtMs: number | null;
  isSyncPlayCurrentPositionPlaying: boolean;
  isInSyncPlayGroup: boolean;
  sendMessage: (message: unknown) => void;
  clearLastMessage: () => void;
  clearLastSyncPlayCommandMessage: () => void;
  clearLastSyncPlayGroupUpdateMessage: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

const SYNC_PLAY_LEAVE_UPDATE_TYPES = new Set<SyncPlayGroupUpdateType>([
  "GroupLeft",
  "NotInGroup",
  "GroupDoesNotExist",
  "LibraryAccessDenied",
]);

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
  return typeof candidate === "number" ? candidate : null;
};

const readBoolean = (
  value: Record<string, unknown> | null,
  pascalKey: string,
  camelKey: string,
): boolean | null => {
  if (!value) {
    return null;
  }

  const candidate = value[pascalKey] ?? value[camelKey];
  return typeof candidate === "boolean" ? candidate : null;
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

  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? null : parsed;
};

const SERVER_TIME_OFFSET_SMOOTHING = 0.2;

export const WebSocketProvider = ({ children }: WebSocketProviderProps) => {
  const api = useAtomValue(apiAtom);
  const { isConnected: isNetworkConnected } = useNetworkStatus();
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [lastSyncPlayCommandMessage, setLastSyncPlayCommandMessage] =
    useState<SyncPlayCommandMessage | null>(null);
  const [lastSyncPlayGroupUpdateMessage, setLastSyncPlayGroupUpdateMessage] =
    useState<SyncPlayGroupUpdateMessage | null>(null);
  const [syncPlayGroupId, setSyncPlayGroupId] = useState<string | null>(null);
  const [syncPlayPlaylistItemId, setSyncPlayPlaylistItemId] = useState<
    string | null
  >(null);
  const [syncPlayCurrentItemId, setSyncPlayCurrentItemId] = useState<
    string | null
  >(null);
  const [syncPlayCurrentPositionTicks, setSyncPlayCurrentPositionTicks] =
    useState<number | null>(null);
  const [
    syncPlayCurrentPositionCapturedAtMs,
    setSyncPlayCurrentPositionCapturedAtMs,
  ] = useState<number | null>(null);
  const [
    isSyncPlayCurrentPositionPlaying,
    setIsSyncPlayCurrentPositionPlaying,
  ] = useState(false);
  const router = useRouter();
  const deviceId = useMemo(() => {
    return getOrSetDeviceId();
  }, []);
  const reconnectAttemptsRef = useRef(0);
  const serverTimeOffsetMsRef = useRef<number | null>(null);

  const updateServerTimeOffset = useCallback((emittedAtMs: number | null) => {
    if (emittedAtMs === null) {
      return;
    }

    const sampleOffsetMs = Date.now() - emittedAtMs;
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

  const setSyncPlayPositionSnapshot = useCallback(
    (positionTicks: number, capturedAtMs?: number | null) => {
      setSyncPlayCurrentPositionTicks(positionTicks);
      setSyncPlayCurrentPositionCapturedAtMs(capturedAtMs ?? Date.now());
    },
    [],
  );

  const connectWebSocket = useCallback(() => {
    if (!deviceId || !api?.accessToken || !isNetworkConnected) {
      return;
    }

    const protocol = api.basePath.includes("https") ? "wss" : "ws";
    const url = `${protocol}://${api.basePath
      .replace("https://", "")
      .replace("http://", "")}/socket?api_key=${
      api.accessToken
    }&deviceId=${deviceId}`;

    const newWebSocket = new WebSocket(url);
    let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

    const maxReconnectAttempts = 5;
    const reconnectDelay = 10000;

    newWebSocket.onopen = () => {
      console.log("WebSocket connection opened");
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      keepAliveInterval = setInterval(() => {
        if (newWebSocket.readyState === WebSocket.OPEN) {
          newWebSocket.send(JSON.stringify({ MessageType: "KeepAlive" }));
        }
      }, 30000);
    };

    newWebSocket.onerror = () => {
      // Don't log errors - this is expected when offline or server unreachable
      setIsConnected(false);

      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        setTimeout(() => {
          connectWebSocket();
        }, reconnectDelay);
      }
    };

    newWebSocket.onclose = () => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }
      setIsConnected(false);
    };
    newWebSocket.onmessage = (e) => {
      try {
        const message = JSON.parse(e.data) as WebSocketMessage;
        setLastMessage(message); // Store the last message in context

        if (isSyncPlayCommandMessage(message)) {
          setLastSyncPlayCommandMessage(message);

          const commandData = asRecord(message.Data);
          const command = readString(commandData, "Command", "command");
          const groupId = readString(commandData, "GroupId", "groupId");
          if (groupId) {
            setSyncPlayGroupId(groupId);
          }

          const whenMs = readDateMs(commandData, "When", "when");
          const emittedAtMs = readDateMs(commandData, "EmittedAt", "emittedAt");
          updateServerTimeOffset(emittedAtMs);
          const localWhenMs = toLocalTimeMs(whenMs);
          const playlistItemId = readString(
            commandData,
            "PlaylistItemId",
            "playlistItemId",
          );
          const positionTicks = readNumber(
            commandData,
            "PositionTicks",
            "positionTicks",
          );
          if (typeof positionTicks === "number") {
            setSyncPlayPositionSnapshot(positionTicks, localWhenMs);
          }
          if (playlistItemId) {
            setSyncPlayPlaylistItemId(playlistItemId);
          }

          if (command === "Unpause") {
            setIsSyncPlayCurrentPositionPlaying(true);
          } else if (command === "Pause" || command === "Stop") {
            setIsSyncPlayCurrentPositionPlaying(false);
          }
        }

        if (isSyncPlayGroupUpdateMessage(message)) {
          setLastSyncPlayGroupUpdateMessage(message);

          const updateData = asRecord(message.Data);
          const updateType = readString(
            updateData,
            "Type",
            "type",
          ) as SyncPlayGroupUpdateType | null;
          const groupId = readString(updateData, "GroupId", "groupId");

          if (updateType && SYNC_PLAY_LEAVE_UPDATE_TYPES.has(updateType)) {
            setSyncPlayGroupId(null);
            setSyncPlayPlaylistItemId(null);
            setSyncPlayCurrentItemId(null);
            setSyncPlayCurrentPositionTicks(null);
            setSyncPlayCurrentPositionCapturedAtMs(null);
            setIsSyncPlayCurrentPositionPlaying(false);
          } else if (groupId) {
            setSyncPlayGroupId(groupId);
          }

          if (updateType === "StateUpdate") {
            const stateData = asRecord(updateData?.Data ?? updateData?.data);
            const groupState = readString(stateData, "State", "state");
            if (groupState === "Playing") {
              setIsSyncPlayCurrentPositionPlaying(true);
            } else if (
              groupState === "Paused" ||
              groupState === "Waiting" ||
              groupState === "Idle"
            ) {
              setIsSyncPlayCurrentPositionPlaying(false);
            }
          }

          if (updateType === "PlayQueue") {
            const playQueueData = asRecord(
              updateData?.Data ?? updateData?.data ?? null,
            );
            const localLastUpdateMs = toLocalTimeMs(
              readDateMs(playQueueData, "LastUpdate", "lastUpdate"),
            );
            const playingItemIndex = readNumber(
              playQueueData,
              "PlayingItemIndex",
              "playingItemIndex",
            );
            const playlist =
              playQueueData?.Playlist ?? playQueueData?.playlist ?? null;
            const startPositionTicks = readNumber(
              playQueueData,
              "StartPositionTicks",
              "startPositionTicks",
            );
            if (typeof startPositionTicks === "number") {
              setSyncPlayPositionSnapshot(
                startPositionTicks,
                localLastUpdateMs,
              );
            }

            const queueIsPlaying = readBoolean(
              playQueueData,
              "IsPlaying",
              "isPlaying",
            );
            if (typeof queueIsPlaying === "boolean") {
              setIsSyncPlayCurrentPositionPlaying(queueIsPlaying);
            }

            if (
              typeof playingItemIndex === "number" &&
              Array.isArray(playlist) &&
              playingItemIndex >= 0 &&
              playingItemIndex < playlist.length
            ) {
              const currentItem = asRecord(playlist[playingItemIndex]);
              const playlistItemId = readString(
                currentItem,
                "PlaylistItemId",
                "playlistItemId",
              );
              const itemId = readString(currentItem, "ItemId", "itemId");
              if (itemId) {
                setSyncPlayCurrentItemId(itemId);
              }
              if (playlistItemId) {
                setSyncPlayPlaylistItemId(playlistItemId);
              }
            }
          }
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };
    setWs(newWebSocket);

    return () => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }
      newWebSocket.close();
    };
  }, [
    api,
    deviceId,
    isNetworkConnected,
    setSyncPlayPositionSnapshot,
    toLocalTimeMs,
    updateServerTimeOffset,
  ]);

  const handlePlayCommand = useCallback(
    (data: unknown) => {
      const payload = asRecord(data);
      const itemIds = payload?.ItemIds;
      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return;
      }

      const firstItemId = itemIds[0];
      if (typeof firstItemId !== "string") {
        return;
      }

      const audioStreamIndex = readNumber(
        payload,
        "AudioStreamIndex",
        "audioStreamIndex",
      );
      const subtitleStreamIndex = readNumber(
        payload,
        "SubtitleStreamIndex",
        "subtitleStreamIndex",
      );
      const playCommand =
        readString(payload, "PlayCommand", "playCommand") ?? "PlayNow";
      const mediaSourceId =
        readString(payload, "MediaSourceId", "mediaSourceId") ?? "";

      router.replace({
        pathname: "/(auth)/player/direct-player",
        params: {
          itemId: firstItemId,
          playCommand,
          audioIndex: audioStreamIndex?.toString(),
          subtitleIndex: subtitleStreamIndex?.toString(),
          mediaSourceId,
          bitrateValue: "",
          offline: "false",
        },
      });
    },
    [router],
  );

  useEffect(() => {
    if (!lastMessage) {
      return;
    }
    if (lastMessage.MessageType === "Play") {
      handlePlayCommand(lastMessage.Data);
    }
  }, [lastMessage, handlePlayCommand]);

  useEffect(() => {
    const cleanup = connectWebSocket();
    return cleanup;
  }, [connectWebSocket]);

  useEffect(() => {
    if (!deviceId || !api || !api?.accessToken || !isNetworkConnected) {
      return;
    }

    const init = async () => {
      try {
        await getSessionApi(api).postFullCapabilities({
          clientCapabilitiesDto: {
            AppStoreUrl:
              "https://apps.apple.com/us/app/streamyfin/id6593660679",
            IconUrl:
              "https://raw.githubusercontent.com/retardgerman/streamyfinweb/refs/heads/main/public/assets/images/icon_new_withoutBackground.png",
            PlayableMediaTypes: ["Audio", "Video"],
            SupportedCommands: ["Play"],
            SupportsMediaControl: true,
            SupportsPersistentIdentifier: true,
          },
        });
      } catch {
        // Silently fail - expected when offline or server unreachable
      }
    };

    init();
  }, [api, deviceId, isNetworkConnected]);

  useEffect(() => {
    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === "background" || state === "inactive") {
        console.log("App moving to background, closing WebSocket...");
        ws?.close();
      } else if (state === "active") {
        console.log("App coming to foreground, reconnecting WebSocket...");
        connectWebSocket();
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    return () => {
      subscription.remove();
      ws?.close();
    };
  }, [ws, connectWebSocket]);
  const sendMessage = useCallback(
    (message: unknown) => {
      if (ws && isConnected) {
        ws.send(JSON.stringify(message));
      }
      // Silently fail when not connected - expected when offline
    },
    [ws, isConnected],
  );
  const clearLastMessage = useCallback(() => {
    setLastMessage(null);
  }, []);
  const clearLastSyncPlayCommandMessage = useCallback(() => {
    setLastSyncPlayCommandMessage(null);
  }, []);
  const clearLastSyncPlayGroupUpdateMessage = useCallback(() => {
    setLastSyncPlayGroupUpdateMessage(null);
  }, []);

  const isInSyncPlayGroup = Boolean(syncPlayGroupId);

  return (
    <WebSocketContext.Provider
      value={{
        ws,
        isConnected,
        lastMessage,
        lastSyncPlayCommandMessage,
        lastSyncPlayGroupUpdateMessage,
        syncPlayGroupId,
        syncPlayPlaylistItemId,
        syncPlayCurrentItemId,
        syncPlayCurrentPositionTicks,
        syncPlayCurrentPositionCapturedAtMs,
        isSyncPlayCurrentPositionPlaying,
        isInSyncPlayGroup,
        sendMessage,
        clearLastMessage,
        clearLastSyncPlayCommandMessage,
        clearLastSyncPlayGroupUpdateMessage,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocketContext = (): WebSocketContextType => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error(
      "useWebSocketContext must be used within a WebSocketProvider",
    );
  }
  return context;
};
