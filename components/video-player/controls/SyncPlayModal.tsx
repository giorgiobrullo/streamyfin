import { Ionicons } from "@expo/vector-icons";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { Button } from "@/components/Button";
import { Input } from "@/components/common/Input";
import { Text } from "@/components/common/Text";
import type {
  SyncPlayGroupInfo,
  SyncPlayPlayQueueUpdateData,
} from "@/services/SyncPlayService";

interface SyncPlayModalProps {
  visible: boolean;
  onClose: () => void;
  simpleMode?: boolean;
  canResumePlayback?: boolean;
  onResumePlayback?: () => void;
  inGroup: boolean;
  groupId: string | null;
  groupInfo: SyncPlayGroupInfo | null;
  queueUpdate: SyncPlayPlayQueueUpdateData | null;
  queueItemNames: Record<string, string>;
  groups: SyncPlayGroupInfo[];
  groupsLoading: boolean;
  actionLoading: boolean;
  error: string | null;
  ignoreWait: boolean;
  currentItemId?: string;
  refreshGroups: () => Promise<void>;
  createGroup: (groupName?: string) => Promise<void>;
  joinGroup: (groupId: string) => Promise<void>;
  leaveGroup: () => Promise<void>;
  toggleIgnoreWait: () => Promise<void>;
  setNewQueueFromCurrentItem: () => Promise<void>;
  queueCurrentItem: (mode: "Queue" | "QueueNext") => Promise<void>;
  clearPlaylist: () => Promise<void>;
  setCurrentPlaylistItem: (playlistItemId: string) => Promise<void>;
  removePlaylistItem: (playlistItemId: string) => Promise<void>;
}

export const SyncPlayModal: FC<SyncPlayModalProps> = ({
  visible,
  onClose,
  simpleMode = false,
  canResumePlayback = false,
  onResumePlayback,
  inGroup,
  groupId,
  groupInfo,
  queueUpdate,
  queueItemNames,
  groups,
  groupsLoading,
  actionLoading,
  error,
  ignoreWait,
  currentItemId,
  refreshGroups,
  createGroup,
  joinGroup,
  leaveGroup,
  toggleIgnoreWait,
  setNewQueueFromCurrentItem,
  queueCurrentItem,
  clearPlaylist,
  setCurrentPlaylistItem,
  removePlaylistItem,
}) => {
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupIdInput, setGroupIdInput] = useState("");

  const spinAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (groupsLoading) {
      spinAnim.setValue(0);
      Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ).start();
    } else {
      spinAnim.stopAnimation();
    }
  }, [groupsLoading, spinAnim]);
  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const canUseCurrentItem = Boolean(currentItemId);
  const participants = groupInfo?.Participants ?? [];
  const queue = queueUpdate?.Playlist ?? [];
  const showPlaybackQueueControls = inGroup && !simpleMode;
  const currentGroupId = groupId || groupInfo?.GroupId;
  const availableGroups = useMemo(() => {
    if (!simpleMode) {
      return groups;
    }
    return groups.filter((group) => {
      if (!group.GroupId) {
        return false;
      }
      if (!inGroup || !currentGroupId) {
        return true;
      }
      return group.GroupId !== currentGroupId;
    });
  }, [groups, simpleMode, inGroup, currentGroupId]);

  const statusText = useMemo(() => {
    if (!inGroup) {
      return "Not in a SyncPlay group";
    }
    return `In group ${groupInfo?.GroupName || "Unnamed group"}`;
  }, [inGroup, groupInfo?.GroupName]);

  return (
    <Modal
      animationType='fade'
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View className='flex-1 bg-black/75 justify-center items-center px-4'>
        <View className='w-full max-w-xl max-h-[88%] bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden'>
          <View className='flex-row justify-between items-center px-4 py-3 border-b border-neutral-800'>
            <Text className='text-lg font-bold text-neutral-100'>SyncPlay</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name='close' size={24} color='white' />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
            <View>
              <Text className='text-sm text-neutral-400'>{statusText}</Text>
            </View>

            {simpleMode ? (
              <View className='flex-row items-center gap-3 p-3 rounded-xl bg-neutral-800 border border-neutral-700'>
                <View className='w-10 h-10 rounded-full bg-neutral-900 border border-neutral-700 items-center justify-center'>
                  <Ionicons
                    name={inGroup ? "people" : "people-outline"}
                    size={18}
                    color={inGroup ? "#34d399" : "#d4d4d8"}
                  />
                </View>
                <View className='flex-1'>
                  <Text className='font-semibold text-neutral-100'>
                    {inGroup
                      ? groupInfo?.GroupName || "Unnamed group"
                      : "Not in group"}
                  </Text>
                  <Text className='text-sm text-neutral-400'>
                    {inGroup
                      ? `${participants.length} participant${participants.length === 1 ? "" : "s"}`
                      : "Create a group or join one below."}
                  </Text>
                </View>
                <TouchableOpacity
                  className='w-10 h-10 rounded-lg bg-neutral-900 border border-neutral-700 items-center justify-center'
                  disabled={actionLoading || groupsLoading}
                  onPress={() => {
                    void refreshGroups();
                  }}
                >
                  <Animated.View style={{ transform: [{ rotate: spin }] }}>
                    <Ionicons name='refresh' size={16} color='#e4e4e7' />
                  </Animated.View>
                </TouchableOpacity>
              </View>
            ) : (
              (groupInfo?.State || participants.length > 0) && (
                <View className='gap-1'>
                  {groupInfo?.State && (
                    <Text className='text-sm text-neutral-400'>
                      Group state: {groupInfo.State}
                    </Text>
                  )}
                  {participants.length > 0 && (
                    <Text className='text-sm text-neutral-400'>
                      Participants: {participants.join(", ")}
                    </Text>
                  )}
                </View>
              )
            )}

            {error && (
              <View className='p-3 rounded-xl border border-red-900 bg-red-950/40'>
                <Text className='text-red-300 text-sm'>{error}</Text>
              </View>
            )}

            <View className='gap-2'>
              <Text className='font-semibold text-neutral-100'>
                {simpleMode ? "Create Group" : "Group Management"}
              </Text>

              {!simpleMode && (
                <View className='flex-row gap-2'>
                  <Button
                    color='black'
                    className='flex-1'
                    disabled={actionLoading}
                    onPress={() => {
                      void refreshGroups();
                    }}
                  >
                    Refresh
                  </Button>
                  <Button
                    color='black'
                    className='flex-1'
                    disabled={actionLoading || !inGroup}
                    onPress={() => {
                      void leaveGroup();
                    }}
                  >
                    Leave
                  </Button>
                </View>
              )}

              <View className='flex-row gap-2 items-stretch'>
                <View className='flex-1'>
                  <Input
                    value={groupNameInput}
                    onChangeText={setGroupNameInput}
                    placeholder={
                      simpleMode ? "Group name (optional)" : "New group name"
                    }
                    autoCapitalize='words'
                  />
                </View>
                <Button
                  color='purple'
                  disabled={actionLoading}
                  onPress={() => {
                    void createGroup(groupNameInput.trim() || undefined).then(
                      () => {
                        setGroupNameInput("");
                      },
                    );
                  }}
                >
                  Create
                </Button>
              </View>

              {!simpleMode && (
                <View className='flex-row gap-2 items-stretch'>
                  <View className='flex-1'>
                    <Input
                      value={groupIdInput}
                      onChangeText={setGroupIdInput}
                      placeholder='Join by group ID'
                      autoCapitalize='none'
                      autoCorrect={false}
                    />
                  </View>
                  <Button
                    color='purple'
                    disabled={actionLoading || groupIdInput.trim().length === 0}
                    onPress={() => {
                      void joinGroup(groupIdInput.trim()).then(() => {
                        setGroupIdInput("");
                      });
                    }}
                  >
                    Join ID
                  </Button>
                </View>
              )}

              {simpleMode && inGroup && (
                <View className='flex-row gap-2'>
                  <Button
                    color='black'
                    className='flex-1'
                    disabled={actionLoading}
                    onPress={() => {
                      void leaveGroup();
                    }}
                  >
                    Leave Group
                  </Button>
                  {canResumePlayback && onResumePlayback && (
                    <Button
                      color='purple'
                      className='flex-1'
                      disabled={actionLoading}
                      onPress={onResumePlayback}
                    >
                      Rejoin Playback
                    </Button>
                  )}
                </View>
              )}
            </View>

            {showPlaybackQueueControls && (
              <View className='gap-2'>
                <Text className='font-semibold text-neutral-100'>Queue</Text>
                <View className='flex-row flex-wrap gap-2'>
                  <Button
                    color='black'
                    disabled={actionLoading || !canUseCurrentItem}
                    onPress={() => {
                      void setNewQueueFromCurrentItem();
                    }}
                  >
                    Set Queue to Current
                  </Button>
                  <Button
                    color='black'
                    disabled={actionLoading || !canUseCurrentItem}
                    onPress={() => {
                      void queueCurrentItem("QueueNext");
                    }}
                  >
                    Queue Next
                  </Button>
                  <Button
                    color='black'
                    disabled={actionLoading || !canUseCurrentItem}
                    onPress={() => {
                      void queueCurrentItem("Queue");
                    }}
                  >
                    Queue End
                  </Button>
                </View>
                <View className='flex-row flex-wrap gap-2'>
                  <Button
                    color='black'
                    disabled={actionLoading}
                    iconLeft={
                      <Ionicons
                        name={ignoreWait ? "eye-off" : "eye"}
                        size={14}
                        color='white'
                      />
                    }
                    onPress={() => {
                      void toggleIgnoreWait();
                    }}
                  >
                    {ignoreWait ? "Ignoring group" : "Following group"}
                  </Button>
                  {queue.length > 0 && (
                    <Button
                      color='black'
                      disabled={actionLoading}
                      onPress={() => {
                        void clearPlaylist();
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </View>
              </View>
            )}

            <View className='gap-2'>
              <Text className='font-semibold text-neutral-100'>
                {simpleMode ? "Join Existing Group" : "Available Groups"}
              </Text>
              {availableGroups.length === 0 && groupsLoading ? (
                <ActivityIndicator />
              ) : availableGroups.length === 0 ? (
                <Text className='text-sm text-neutral-400'>
                  {simpleMode
                    ? "No joinable groups right now."
                    : "No groups available."}
                </Text>
              ) : (
                availableGroups.map((group, index) => (
                  <View
                    key={`${group.GroupId || group.GroupName || "group"}-${index}`}
                    className='flex-row items-center gap-2 p-3 rounded-xl bg-neutral-800 border border-neutral-700'
                  >
                    <View className='flex-1'>
                      <Text className='text-neutral-100'>
                        {group.GroupName || "Unnamed group"}
                      </Text>
                      <Text className='text-xs text-neutral-500'>
                        {group.Participants && group.Participants.length > 0
                          ? group.Participants.join(", ")
                          : "No participants"}
                      </Text>
                    </View>
                    <Button
                      color='purple'
                      disabled={actionLoading || !group.GroupId}
                      onPress={() => {
                        if (group.GroupId) {
                          void joinGroup(group.GroupId);
                        }
                      }}
                    >
                      Join
                    </Button>
                  </View>
                ))
              )}
            </View>

            {showPlaybackQueueControls && queue.length > 0 && (
              <View className='gap-2'>
                <Text className='font-semibold text-neutral-100'>Playlist</Text>
                {queue.map((queueItem, index) => {
                  const isCurrent = queueUpdate?.PlayingItemIndex === index;
                  const disabled = actionLoading || !queueItem.PlaylistItemId;
                  const itemName = queueItem.ItemId
                    ? (queueItemNames[queueItem.ItemId] ?? "Loading...")
                    : "Unknown";
                  return (
                    <TouchableOpacity
                      key={`${queueItem.PlaylistItemId || queueItem.ItemId || index}`}
                      className={`flex-row items-center gap-2 p-2.5 rounded-lg ${
                        isCurrent ? "bg-emerald-500/10" : ""
                      }`}
                      disabled={disabled}
                      onPress={() => {
                        if (queueItem.PlaylistItemId && !isCurrent) {
                          void setCurrentPlaylistItem(queueItem.PlaylistItemId);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <View className='w-6 items-center justify-center'>
                        {isCurrent ? (
                          <Ionicons
                            name='musical-note'
                            size={14}
                            color='#34d399'
                          />
                        ) : (
                          <Text className='text-xs text-neutral-500 text-center'>
                            {index + 1}
                          </Text>
                        )}
                      </View>
                      <View className='flex-1'>
                        <Text
                          className={
                            isCurrent
                              ? "font-semibold text-emerald-400"
                              : "text-neutral-100"
                          }
                          numberOfLines={1}
                        >
                          {itemName}
                        </Text>
                      </View>
                      {!isCurrent && queueItem.PlaylistItemId && (
                        <TouchableOpacity
                          hitSlop={8}
                          disabled={actionLoading}
                          onPress={() => {
                            if (queueItem.PlaylistItemId) {
                              void removePlaylistItem(queueItem.PlaylistItemId);
                            }
                          }}
                        >
                          <Ionicons
                            name='close-circle'
                            size={20}
                            color='#71717a'
                          />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
