import type { ComponentType } from "react";

/** Props every React Native icon accepts; mirrors `lucide-react-native`. */
export interface NativeIconProps {
  absoluteStrokeWidth?: boolean;
  color?: string;
  size?: number | string;
  strokeWidth?: number | string;
  testID?: string;
}

export type NativeIcon = ComponentType<NativeIconProps>;
