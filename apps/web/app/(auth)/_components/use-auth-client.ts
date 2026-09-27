"use client";

import {
  createWebAuthClient,
  type WebAuthClient,
} from "@workspace/auth/client";
import { useState } from "react";

/** Better Auth's browser client, one per mounted form (no module singleton). */
export const useAuthClient = (): WebAuthClient =>
  useState(() => createWebAuthClient())[0];
