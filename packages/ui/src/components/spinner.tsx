import { useLingui } from "@lingui/react/macro";
import { Loader2Icon } from "@workspace/icons";
import { cn } from "cn";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useLingui();
  return (
    <Loader2Icon
      aria-label={t`Loading`}
      className={cn("size-4 animate-spin", className)}
      data-slot="spinner"
      role="status"
      {...props}
    />
  );
}

export { Spinner };
