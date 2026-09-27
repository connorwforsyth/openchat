import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import type { ReactNode } from "react";

/** The one frame every auth page uses: a title, a line under it, the form. */
export const AuthCard = ({
  children,
  description,
  footer,
  title,
}: {
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly title: ReactNode;
}) => (
  <div className="flex w-full max-w-sm flex-col gap-4">
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
    {footer ? (
      <p className="text-center text-muted-foreground text-sm">{footer}</p>
    ) : null}
  </div>
);
