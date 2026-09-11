export type SiteCoordinates = {
  x: number;
  y: number;
};
export type SiteLocation = {
  city: string;
  country: string;
  updatedOn: string;
  coordinates: SiteCoordinates;
};

export type SiteEvent = {
  id: string;
  name: string;
  city: string;
  country: string;
  startsOn: string;
  endsOn: string;
  url: string;
  role?: string;
  status?: "upcoming" | "past";
};

export type SiteContent = {
  schemaVersion: 1;
  location: SiteLocation;
  events: SiteEvent[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseSiteContent(value: unknown): SiteContent {
  const content = object(value, "content");
  exactKeys(content, ["schemaVersion", "location", "events"], "content");
  if (content.schemaVersion !== 1) {
    throw new Error("content.schemaVersion must be 1");
  }

  const location = object(content.location, "content.location");
  exactKeys(location, ["city", "country", "updatedOn", "coordinates"], "content.location");
  const coordinates = object(location.coordinates, "content.location.coordinates");
  exactKeys(coordinates, ["x", "y"], "content.location.coordinates");

  if (!Array.isArray(content.events) || content.events.length > 200) {
    throw new Error("content.events must be an array with at most 200 entries");
  }

  const ids = new Set<string>();
  const events = content.events.map((value, index) => {
    const label = `content.events[${index}]`;
    const event = object(value, label);
    exactKeys(
      event,
      ["id", "name", "city", "country", "startsOn", "endsOn", "url", "role", "status"],
      label,
    );

    const id = string(event.id, `${label}.id`, 80);
    if (!EVENT_ID.test(id)) throw new Error(`${label}.id must be kebab-case`);
    if (ids.has(id)) throw new Error(`${label}.id must be unique`);
    ids.add(id);

    const startsOn = date(event.startsOn, `${label}.startsOn`);
    const endsOn = date(event.endsOn, `${label}.endsOn`);
    if (startsOn > endsOn) {
      throw new Error(`${label}.startsOn must not be after endsOn`);
    }

    const url = string(event.url, `${label}.url`, 500);
    if (new URL(url).protocol !== "https:") {
      throw new Error(`${label}.url must use HTTPS`);
    }

    const status: SiteEvent["status"] = event.status === "upcoming" || event.status === "past" ? event.status : undefined;
    if (event.status !== undefined && status === undefined) throw new Error(`${label}.status must be upcoming or past`);

    return {
      id,
      name: string(event.name, `${label}.name`, 150),
      city: string(event.city, `${label}.city`, 100),
      country: string(event.country, `${label}.country`, 100),
      startsOn,
      endsOn,
      url,
      ...(event.role === undefined
        ? {}
        : { role: string(event.role, `${label}.role`, 50) }),
      ...(status === undefined ? {} : { status }),
    };
  });

  return {
    schemaVersion: 1,
    location: {
      city: string(location.city, "content.location.city", 100),
      country: string(location.country, "content.location.country", 100),
      updatedOn: date(location.updatedOn, "content.location.updatedOn"),
      coordinates: {
        x: coordinate(coordinates.x, "content.location.coordinates.x"),
        y: coordinate(coordinates.y, "content.location.coordinates.y"),
      },
    },
    events,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} has unknown field: ${unknown[0]}`);
  const missing = allowed.filter(
    (key) => !["role", "status"].includes(key) && !Object.hasOwn(value, key),
  );
  if (missing.length) throw new Error(`${label} is missing field: ${missing[0]}`);
}

function string(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function date(value: unknown, label: string): string {
  const result = string(value, label, 10);
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!ISO_DATE.test(result) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error(`${label} must be a valid ISO date`);
  }
  return result;
}

function coordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a number between 0 and 100`);
  }
  return value;
}
