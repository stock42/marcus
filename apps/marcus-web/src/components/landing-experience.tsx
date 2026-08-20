"use client";

import { useEffect } from "react";
import { mountLandingExperience } from "@/lib/landing-runtime";

export function LandingExperience() {
  useEffect(() => mountLandingExperience(), []);
  return null;
}
