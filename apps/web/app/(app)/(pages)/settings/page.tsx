import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

export default function SettingsIndex() {
  redirect(routes.settings("profile"));
}
