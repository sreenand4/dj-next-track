import { Compass, Layers, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/finder",
    label: "Next Track Finder",
    description: "Find the ideal next song by key, BPM, genre & energy",
    icon: Compass,
  },
  {
    href: "/transitions",
    label: "My Transitions",
    description: "Save the transitions you've made and recall them later",
    icon: Layers,
  },
];
