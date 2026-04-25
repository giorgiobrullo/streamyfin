import { Ionicons } from "@expo/vector-icons";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
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

const actionButtonClass = (disabled: boolean) =>
  `px-3 py-2 rounded-lg ${disabled ? "bg-zinc-700" : "bg-zinc-800"}`;

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
      return "Not in SyncPlay group";
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
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text className='text-lg font-bold'>SyncPlay</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name='close' size={24} color='white' />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {simpleMode ? (
              <View style={styles.simpleHero}>
                <View style={styles.simpleHeroIcon}>
                  <Ionicons
                    name={inGroup ? "people" : "people-outline"}
                    size={18}
                    color={inGroup ? "#34d399" : "#d4d4d8"}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text className='font-semibold'>
                    {inGroup
                      ? groupInfo?.GroupName || "Unnamed group"
                      : "Not in group"}
                  </Text>
                  <Text className='text-sm opacity-70'>
                    {inGroup
                      ? `${participants.length} participant${participants.length === 1 ? "" : "s"}`
                      : "Create a group or join one below."}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.simpleIconButton}
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
              <View className='space-y-1'>
                <Text className='text-sm opacity-70'>{statusText}</Text>
                {groupInfo?.State && (
                  <Text className='text-sm opacity-70'>
                    Group state: {groupInfo.State}
                  </Text>
                )}
                {participants.length > 0 && (
                  <Text className='text-sm opacity-70'>
                    Participants: {participants.join(", ")}
                  </Text>
                )}
              </View>
            )}

            {error && (
              <View style={styles.errorCard}>
                <Text className='text-red-300 text-sm'>{error}</Text>
              </View>
            )}

            <View style={styles.section}>
              {simpleMode ? (
                <>
                  <Text className='font-semibold'>Create Group</Text>
                  <View style={styles.createRow}>
                    <TextInput
                      value={groupNameInput}
                      onChangeText={setGroupNameInput}
                      placeholder='Group name (optional)'
                      placeholderTextColor='#888'
                      style={styles.input}
                    />
                    <TouchableOpacity
                      style={[
                        styles.simplePrimaryButton,
                        actionLoading && styles.simplePrimaryButtonDisabled,
                      ]}
                      disabled={actionLoading}
                      onPress={() => {
                        void createGroup(
                          groupNameInput.trim() || undefined,
                        ).then(() => {
                          setGroupNameInput("");
                        });
                      }}
                    >
                      <Text className='font-semibold'>Create</Text>
                    </TouchableOpacity>
                  </View>
                  {inGroup && (
                    <View style={styles.inlineRow}>
                      <TouchableOpacity
                        style={[
                          styles.simpleSecondaryButton,
                          actionLoading && styles.simpleSecondaryButtonDisabled,
                        ]}
                        disabled={actionLoading}
                        onPress={() => {
                          void leaveGroup();
                        }}
                      >
                        <Text>Leave Group</Text>
                      </TouchableOpacity>
                      {canResumePlayback && onResumePlayback && (
                        <TouchableOpacity
                          style={[
                            styles.simplePrimaryButton,
                            actionLoading && styles.simplePrimaryButtonDisabled,
                          ]}
                          disabled={actionLoading}
                          onPress={onResumePlayback}
                        >
                          <Text className='font-semibold'>Rejoin Playback</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text className='font-semibold'>Group Management</Text>
                  <View style={styles.inlineRow}>
                    <TouchableOpacity
                      className={actionButtonClass(actionLoading)}
                      disabled={actionLoading}
                      onPress={() => {
                        void refreshGroups();
                      }}
                    >
                      <Text>Refresh</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className={actionButtonClass(actionLoading || !inGroup)}
                      disabled={actionLoading || !inGroup}
                      onPress={() => {
                        void leaveGroup();
                      }}
                    >
                      <Text>Leave</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.createRow}>
                    <TextInput
                      value={groupNameInput}
                      onChangeText={setGroupNameInput}
                      placeholder='New group name'
                      placeholderTextColor='#888'
                      style={styles.input}
                    />
                    <TouchableOpacity
                      className={actionButtonClass(actionLoading)}
                      disabled={actionLoading}
                      onPress={() => {
                        void createGroup(
                          groupNameInput.trim() || undefined,
                        ).then(() => {
                          setGroupNameInput("");
                        });
                      }}
                    >
                      <Text>Create</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.createRow}>
                    <TextInput
                      value={groupIdInput}
                      onChangeText={setGroupIdInput}
                      placeholder='Join by group ID'
                      placeholderTextColor='#888'
                      style={styles.input}
                      autoCapitalize='none'
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      className={actionButtonClass(
                        actionLoading || groupIdInput.trim().length === 0,
                      )}
                      disabled={
                        actionLoading || groupIdInput.trim().length === 0
                      }
                      onPress={() => {
                        void joinGroup(groupIdInput.trim()).then(() => {
                          setGroupIdInput("");
                        });
                      }}
                    >
                      <Text>Join ID</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            {showPlaybackQueueControls && (
              <View style={styles.section}>
                <Text className='font-semibold'>Queue</Text>
                <View style={styles.inlineRow}>
                  <TouchableOpacity
                    className={actionButtonClass(
                      actionLoading || !canUseCurrentItem,
                    )}
                    disabled={actionLoading || !canUseCurrentItem}
                    onPress={() => {
                      void setNewQueueFromCurrentItem();
                    }}
                  >
                    <Text>Set Queue to Current</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className={actionButtonClass(
                      actionLoading || !canUseCurrentItem,
                    )}
                    disabled={actionLoading || !canUseCurrentItem}
                    onPress={() => {
                      void queueCurrentItem("QueueNext");
                    }}
                  >
                    <Text>Queue Next</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className={actionButtonClass(
                      actionLoading || !canUseCurrentItem,
                    )}
                    disabled={actionLoading || !canUseCurrentItem}
                    onPress={() => {
                      void queueCurrentItem("Queue");
                    }}
                  >
                    <Text>Queue End</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.inlineRow}>
                  <TouchableOpacity
                    className={actionButtonClass(actionLoading)}
                    disabled={actionLoading}
                    onPress={() => {
                      void toggleIgnoreWait();
                    }}
                  >
                    <Ionicons
                      name={ignoreWait ? "eye-off" : "eye"}
                      size={14}
                      color='white'
                      style={{ marginRight: 4 }}
                    />
                    <Text>
                      {ignoreWait ? "Ignoring group" : "Following group"}
                    </Text>
                  </TouchableOpacity>
                  {queue.length > 0 && (
                    <TouchableOpacity
                      className={actionButtonClass(actionLoading)}
                      disabled={actionLoading}
                      onPress={() => {
                        void clearPlaylist();
                      }}
                    >
                      <Text>Clear</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text className='font-semibold'>
                {simpleMode ? "Join Existing Group" : "Available Groups"}
              </Text>
              {availableGroups.length === 0 && !groupsLoading ? (
                <Text className='text-sm opacity-70'>
                  {simpleMode
                    ? "No joinable groups right now."
                    : "No groups available."}
                </Text>
              ) : availableGroups.length === 0 && groupsLoading ? (
                <ActivityIndicator />
              ) : (
                availableGroups.map((group, index) => (
                  <View
                    style={simpleMode ? styles.simpleGroupRow : styles.groupRow}
                    key={`${group.GroupId || group.GroupName || "group"}-${index}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text>{group.GroupName || "Unnamed group"}</Text>
                      <Text className='text-xs opacity-70'>
                        {group.Participants && group.Participants.length > 0
                          ? group.Participants.join(", ")
                          : "No participants"}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={
                        simpleMode
                          ? [
                              styles.simplePrimaryButton,
                              (actionLoading || !group.GroupId) &&
                                styles.simplePrimaryButtonDisabled,
                            ]
                          : undefined
                      }
                      className={
                        simpleMode
                          ? undefined
                          : actionButtonClass(actionLoading)
                      }
                      disabled={actionLoading || !group.GroupId}
                      onPress={() => {
                        if (group.GroupId) {
                          void joinGroup(group.GroupId);
                        }
                      }}
                    >
                      <Text className={simpleMode ? "font-semibold" : ""}>
                        Join
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>

            {showPlaybackQueueControls && queue.length > 0 && (
              <View style={styles.section}>
                <Text className='font-semibold'>Playlist</Text>
                {queue.map((queueItem, index) => {
                  const isCurrent = queueUpdate?.PlayingItemIndex === index;
                  const disabled = actionLoading || !queueItem.PlaylistItemId;
                  const itemName = queueItem.ItemId
                    ? (queueItemNames[queueItem.ItemId] ?? "Loading...")
                    : "Unknown";
                  return (
                    <TouchableOpacity
                      key={`${queueItem.PlaylistItemId || queueItem.ItemId || index}`}
                      style={[
                        styles.queueRow,
                        isCurrent && styles.queueRowCurrent,
                      ]}
                      disabled={disabled}
                      onPress={() => {
                        if (queueItem.PlaylistItemId && !isCurrent) {
                          void setCurrentPlaylistItem(queueItem.PlaylistItemId);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.queueIndex}>
                        {isCurrent ? (
                          <Ionicons
                            name='musical-note'
                            size={14}
                            color='#34d399'
                          />
                        ) : (
                          <Text
                            className='text-xs opacity-50'
                            style={{ textAlign: "center" }}
                          >
                            {index + 1}
                          </Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          className={isCurrent ? "font-semibold" : ""}
                          style={isCurrent ? { color: "#34d399" } : undefined}
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    width: "92%",
    maxHeight: "88%",
    backgroundColor: "#151515",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    overflow: "hidden",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  simpleHero: {
    borderWidth: 1,
    borderColor: "#2c3445",
    backgroundColor: "#1b2230",
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  simpleHeroIcon: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#374151",
  },
  simpleIconButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#374151",
  },
  errorCard: {
    borderWidth: 1,
    borderColor: "#7f1d1d",
    backgroundColor: "#261111",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  createRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  simplePrimaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "#3b82f6",
  },
  simplePrimaryButtonDisabled: {
    opacity: 0.5,
  },
  simpleSecondaryButton: {
    backgroundColor: "#202020",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  simpleSecondaryButtonDisabled: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    backgroundColor: "#202020",
    borderWidth: 1,
    borderColor: "#313131",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#fff",
  },
  groupRow: {
    borderWidth: 1,
    borderColor: "#2f2f2f",
    borderRadius: 8,
    padding: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  simpleGroupRow: {
    borderWidth: 1,
    borderColor: "#243047",
    borderRadius: 10,
    backgroundColor: "#111827",
    padding: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  queueRow: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  queueRowCurrent: {
    backgroundColor: "rgba(52, 211, 153, 0.08)",
    borderRadius: 8,
  },
  queueIndex: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
