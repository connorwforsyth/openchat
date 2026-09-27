import { redirect } from "next/navigation";

import { routes } from "../_shared/routes";

export default function SettingsIndex() {
  redirect(routes.settings("profile"));
}
