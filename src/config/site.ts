import { SITE_ORIGIN } from "./site-origin.js";
import {
  formatIsoDate,
  getConferences,
  getSiteContent,
  type ClassifiedConferences,
  type DisplayConference,
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

export type SiteLocationView = {
  city: string;
  country: string;
  updated: string;
  coordinates: { x: number; y: number };
  map: {
    src: string;
    attribution: string;
    attributionUrl: string;
  };
};

const MAP = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Blank_Gomberg_World_map.png/1280px-Blank_Gomberg_World_map.png",
  attribution: "Map: Wikimedia Commons",
  attributionUrl:
    "https://commons.wikimedia.org/wiki/File:Blank_Gomberg_World_map.png",
} as const;

/**
 * The site configuration.
 *
 * Everything here is static except `location` and `conferences`, which are the
 * two mutable content surfaces. They are exposed as getters so a reader keeps
 * writing `site.location.city` / `site.conferences.upcoming` unchanged, while
 * the value is resolved per request: the static build sees the build-time
 * default, and the request-time renderer sees the content it read from S3 for
 * that request (see `site-content-source.ts`). The getters read fresh on every
 * access, so a content override that is set for one request never leaks into
 * another and no reader caches a stale value.
 */
export const site = {
  name: "Salih Güler",
  shortName: "Salih",
  url: SITE_ORIGIN,
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
  get location(): SiteLocationView {
    const { location } = getSiteContent();
    return {
      city: location.city,
      country: location.country,
      updated: formatIsoDate(location.updatedOn),
      coordinates: location.coordinates,
      map: MAP,
    };
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
  get conferences(): ClassifiedConferences {
    return getConferences();
  },
} as const;

export type { DisplayConference };

export const navigation = [
  { label: "About", href: "/about/" },
  { label: "Blog", href: "/blog/" },
  { label: "Talks", href: "/talks/" },
  { label: "Contact", href: "/contact/" },
] as const;
