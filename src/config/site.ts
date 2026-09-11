import {
  conferences,
  formatIsoDate,
  siteContent,
} from "./site-content";

export type SocialKey = "linkedin" | "x" | "github" | "bluesky";

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
  role?: string;
};

export const site = {
  name: "Salih Güler",
  shortName: "Salih",
  url: "https://salih.dev",
  description:
    "Salih Güler is a Senior Developer Advocate at AWS focused on frontend and mobile app development, developer experience, and serverless architecture.",
  defaultImage:
    "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1600&q=82",
  email: null,
  role: "Senior Developer Advocate at AWS",
  jobTitle: "Senior Developer Advocate",
  organization: "AWS",
  bio: {
    short:
      "Salih is a Senior Developer Advocate at AWS with a strong focus on frontend and mobile app development, developer experience, and serverless architecture.",
    long: [
      "I am a Senior Developer Advocate at AWS based in Berlin, Germany. My work focuses on frontend and mobile app development, developer experience, and serverless architecture.",
      "I help developers turn complex technical ideas into approachable, practical solutions. I also speak at developer conferences and community events, sharing lessons from the intersection of client applications, cloud systems, and developer tooling.",
    ],
  },
  focusAreas: [
    "Frontend development",
    "Mobile app development",
    "Developer experience",
    "Serverless architecture",
  ],
  location: {
    city: siteContent.location.city,
    country: siteContent.location.country,
    updated: formatIsoDate(siteContent.location.updatedOn),
    coordinates: siteContent.location.coordinates,
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
      href: "https://www.linkedin.com/in/salihgueler",
      icon: "linkedin",
    },
    {
      label: "X",
      href: "https://x.com/salihgueler",
      icon: "x",
    },
    {
      label: "GitHub",
      href: "https://github.com/salihgueler",
      icon: "github",
    },
    {
      label: "Bluesky",
      href: "https://bsky.app/profile/salihgueler.dev",
      icon: "bluesky",
    },
  ] satisfies SocialLink[],
  conferences: conferences satisfies Record<
    "upcoming" | "recent",
    Conference[]
  >,
} as const;

export const navigation = [
  { label: "About", href: "/about/" },
  { label: "Blog", href: "/blog/" },
  { label: "Contact", href: "/contact/" },
] as const;
