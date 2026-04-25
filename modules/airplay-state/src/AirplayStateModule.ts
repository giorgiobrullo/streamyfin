import { NativeModule, requireNativeModule } from "expo";
import type { AirplayStateEvents } from "./AirplayState.types";

declare class AirplayStateModule extends NativeModule<AirplayStateEvents> {
  isActive(): Promise<boolean>;
}

export default requireNativeModule<AirplayStateModule>("AirplayState");
