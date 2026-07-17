export type SocialKey = "linkedin" | "x" | "github" | "instagram";

export type SocialLink = {
  label: string;
  href: string;
  icon: SocialKey;
};

export type Conference = {
  name: string;
  location: string;
  date: string;
  href?: string;
};

export const site = {
  name: "Salih Güler",
  shortName: "Salih",
  url: "https://salih.dev",
  description:
    "Notes on software engineering, developer communities, travel, and building systems that stay understandable.",
  email: "hello@salih.dev",
  role: "Software engineer, speaker, and community builder",
  location: {
    city: "Berlin",
    country: "Germany",
    updated: "July 2026",
    coordinates: {
      x: 53,
      y: 32,
    },
    map: {
      src: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Blank_Gomberg_World_map.png/1280px-Blank_Gomberg_World_map.png",
      attribution: "Map: Wikimedia Commons",
      attributionUrl:
        "https://commons.wikimedia.org/wiki/File:Blank_Gomberg_World_map.png",
    },
  },
  socials: [
    {
      label: "LinkedIn",
      href: "https://www.linkedin.com/",
      icon: "linkedin",
    },
    {
      label: "X",
      href: "https://x.com/",
      icon: "x",
    },
    {
      label: "GitHub",
      href: "https://github.com/",
      icon: "github",
    },
    {
      label: "Instagram",
      href: "https://www.instagram.com/",
      icon: "instagram",
    },
  ] satisfies SocialLink[],
  conferences: {
    upcoming: [
      {
        name: "Community Systems Forum",
        location: "Amsterdam, Netherlands",
        date: "October 15, 2026",
      },
    ],
    recent: [
      {
        name: "Open Source Summit",
        location: "Berlin, Germany",
        date: "May 12, 2026",
      },
      {
        name: "Developer Experience Days",
        location: "Lisbon, Portugal",
        date: "November 7, 2025",
      },
      {
        name: "Mobile Makers",
        location: "London, United Kingdom",
        date: "September 18, 2025",
      },
    ],
  } satisfies Record<"upcoming" | "recent", Conference[]>,
} as const;

export const navigation = [
  { label: "About", href: "/about/" },
  { label: "Blog", href: "/blog/" },
  { label: "Contact", href: "/contact/" },
] as const;
