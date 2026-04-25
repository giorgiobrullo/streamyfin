import { Platform } from "react-native";
import type { AirplayStateEvents } from "./src/AirplayState.types";
import AirplayStateModuleNative from "./src/AirplayStateModule";

export type {
  AirplayStateEvents,
  RouteChangeEvent,
} from "./src/AirplayState.types";

const isSupported = Platform.OS === "ios";

export const AirplayState = {
  /**
   * Returns true if the current AVAudioSession route includes an AirPlay output.
   * Resolves to false on non-iOS platforms.
   */
  isActive: async (): Promise<boolean> => {
    if (!isSupported) return false;
    return AirplayStateModuleNative.isActive();
  },

  /**
   * Subscribe to route changes. The callback fires whenever the audio session
   * route changes, with the new "AirPlay active" boolean.
   * No-op on non-iOS; returns a function that does nothing.
   */
  addRouteChangeListener: (
    listener: AirplayStateEvents["routeChange"],
  ): (() => void) => {
    if (!isSupported) return () => {};
    const subscription = AirplayStateModuleNative.addListener(
      "routeChange",
      listener,
    );
    return () => subscription.remove();
  },
};
