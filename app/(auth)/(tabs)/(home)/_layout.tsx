import { Feather, Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { nestedTabPageScreenOptions } from "@/components/stacks/NestedTabPageStack";
import { SyncPlayModal } from "@/components/video-player/controls/SyncPlayModal";
import useRouter from "@/hooks/useAppRouter";
import { useSyncPlay } from "@/hooks/useSyncPlay";

const Chromecast = Platform.isTV ? null : require("@/components/Chromecast");

import { useAtom } from "jotai";
import { useSessions, type useSessionsProps } from "@/hooks/useSessions";
import { userAtom } from "@/providers/JellyfinProvider";
import { useWebSocketContext } from "@/providers/WebSocketProvider";
import { useSettings } from "@/utils/atoms/settings";

export default function IndexLayout() {
  const _router = useRouter();
  const [user] = useAtom(userAtom);
  const { t } = useTranslation();

  return (
    <Stack>
      <Stack.Screen
        name='index'
        options={{
          headerShown: !Platform.isTV,
          headerTitle: t("tabs.home"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerRight: () => (
            <HomeHeaderRight
              isAdministrator={Boolean(user?.Policy?.IsAdministrator)}
            />
          ),
        }}
      />
      <Stack.Screen
        name='downloads/index'
        options={{
          headerShown: true,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          title: t("home.downloads.downloads_title"),
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='sessions/index'
        options={{
          title: t("home.sessions.title"),
          headerShown: true,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings'
        options={{
          title: t("home.settings.settings_title"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/playback-controls/page'
        options={{
          title: t("home.settings.playback_controls.title"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/audio-subtitles/page'
        options={{
          title: t("home.settings.audio_subtitles.title"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/appearance/page'
        options={{
          title: t("home.settings.appearance.title"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/music/page'
        options={{
          title: t("home.settings.music.title"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/appearance/hide-libraries/page'
        options={{
          title: t("home.settings.other.hide_libraries"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/plugins/page'
        options={{
          title: t("home.settings.plugins.plugins_title"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/plugins/marlin-search/page'
        options={{
          title: "Marlin Search",
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/plugins/jellyseerr/page'
        options={{
          title: "Jellyseerr",
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/plugins/streamystats/page'
        options={{
          title: "Streamystats",
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/plugins/kefinTweaks/page'
        options={{
          title: "KefinTweaks",
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/intro/page'
        options={{
          title: t("home.settings.intro.title"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/logs/page'
        options={{
          title: t("home.settings.logs.logs_title"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/network/page'
        options={{
          title: t("home.settings.network.title"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      {Object.entries(nestedTabPageScreenOptions).map(([name, options]) => (
        <Stack.Screen key={name} name={name} options={options} />
      ))}
      <Stack.Screen
        name='collections/[collectionId]'
        options={{
          title: "",
          headerLeft: () => (
            <Pressable onPress={() => _router.back()} className='pl-0.5'>
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
          headerShown: true,
          headerBlurEffect: "prominent",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
        }}
      />
    </Stack>
  );
}

const SettingsButton = () => {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => {
        router.push("/(auth)/settings");
      }}
    >
      <Feather name='settings' color={"white"} size={22} />
    </Pressable>
  );
};

const SessionsButton = () => {
  const router = useRouter();
  const { sessions = [] } = useSessions({} as useSessionsProps);

  return (
    <Pressable
      onPress={() => {
        router.push("/(auth)/sessions");
      }}
      className='mr-4'
    >
      <Ionicons
        name='play-circle'
        color={sessions.length === 0 ? "white" : "#9333ea"}
        size={28}
      />
    </Pressable>
  );
};

type HomeHeaderRightProps = {
  isAdministrator: boolean;
};

const HomeHeaderRight = ({ isAdministrator }: HomeHeaderRightProps) => {
  const router = useRouter();
  const { settings } = useSettings();
  const [showSyncPlayModal, setShowSyncPlayModal] = useState(false);
  const {
    isInSyncPlayGroup,
    syncPlayCurrentItemId,
    syncPlayCurrentPositionTicks,
    syncPlayCurrentPositionCapturedAtMs,
    isSyncPlayCurrentPositionPlaying,
  } = useWebSocketContext();
  const syncPlay = useSyncPlay({
    offline: false,
    suppressToasts: true,
  });
  const canResumePlayback = Boolean(isInSyncPlayGroup && syncPlayCurrentItemId);

  const estimatedPositionTicks =
    typeof syncPlayCurrentPositionTicks === "number"
      ? Math.max(
          0,
          Math.round(
            syncPlayCurrentPositionTicks +
              (isSyncPlayCurrentPositionPlaying &&
              typeof syncPlayCurrentPositionCapturedAtMs === "number"
                ? Math.max(
                    0,
                    Date.now() - syncPlayCurrentPositionCapturedAtMs,
                  ) * 10_000
                : 0),
          ),
        )
      : undefined;

  const handleResumePlayback = useCallback(() => {
    if (!syncPlayCurrentItemId) {
      return;
    }

    router.push({
      pathname: "/(auth)/player/direct-player",
      params: {
        itemId: syncPlayCurrentItemId,
        offline: "false",
        playbackPosition: estimatedPositionTicks?.toString(),
      },
    });
    setShowSyncPlayModal(false);
  }, [router, syncPlayCurrentItemId, estimatedPositionTicks]);

  const syncPlayRef = useRef(syncPlay);
  syncPlayRef.current = syncPlay;
  const handleResumePlaybackRef = useRef(handleResumePlayback);
  handleResumePlaybackRef.current = handleResumePlayback;
  const wasInGroupRef = useRef(syncPlay.inGroup);
  const prevItemIdRef = useRef(syncPlayCurrentItemId);

  // Auto-open player when:
  // 1. Joining a group that already has an active item
  // 2. Already in a group and playback starts (item goes from null to something)
  useEffect(() => {
    const justJoinedGroup = !wasInGroupRef.current && syncPlay.inGroup;
    const playbackJustStarted =
      syncPlay.inGroup && !prevItemIdRef.current && syncPlayCurrentItemId;

    if ((justJoinedGroup || playbackJustStarted) && syncPlayCurrentItemId) {
      handleResumePlaybackRef.current();
    }

    wasInGroupRef.current = syncPlay.inGroup;
    prevItemIdRef.current = syncPlayCurrentItemId;
  }, [syncPlay.inGroup, syncPlayCurrentItemId]);

  useEffect(() => {
    if (!showSyncPlayModal) {
      return;
    }
    void syncPlayRef.current.refreshGroups();
    if (syncPlayRef.current.inGroup) {
      void syncPlayRef.current.refreshCurrentGroup();
    }
  }, [showSyncPlayModal]);

  return (
    <View className='flex flex-row items-center px-2'>
      {!Platform.isTV && (
        <>
          <Chromecast.Chromecast background='transparent' />
          {isAdministrator && <SessionsButton />}
          {settings.showHomeSyncPlayButton && (
            <HomeSyncPlayButton
              isInSyncPlayGroup={isInSyncPlayGroup}
              onOpenSyncPlay={() => setShowSyncPlayModal(true)}
            />
          )}
          <SettingsButton />
        </>
      )}
      {!Platform.isTV && (
        <SyncPlayModal
          visible={showSyncPlayModal}
          onClose={() => setShowSyncPlayModal(false)}
          simpleMode
          canResumePlayback={canResumePlayback}
          onResumePlayback={handleResumePlayback}
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
      )}
    </View>
  );
};

type HomeSyncPlayButtonProps = {
  isInSyncPlayGroup: boolean;
  onOpenSyncPlay: () => void;
};

const HomeSyncPlayButton = ({
  isInSyncPlayGroup,
  onOpenSyncPlay,
}: HomeSyncPlayButtonProps) => {
  return (
    <Pressable
      onPress={() => {
        onOpenSyncPlay();
      }}
      className='mr-4'
    >
      <Ionicons
        name={isInSyncPlayGroup ? "people" : "people-outline"}
        color={isInSyncPlayGroup ? "#34d399" : "white"}
        size={24}
      />
    </Pressable>
  );
};
