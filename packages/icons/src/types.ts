import type { ComponentProps, ComponentType } from "react";

/**
 * Props every web icon accepts, whichever set draws it. It is lucide's prop
 * surface (lucide is the vocabulary), so call sites written against lucide keep
 * compiling after the codemod. Sets that can't honour a prop ignore it.
 */
export type IconProps = ComponentProps<"svg"> & {
  absoluteStrokeWidth?: boolean;
  nonScalingStroke?: boolean;
  size?: number | string;
};

export type Icon = ComponentType<IconProps>;
