import "dotenv/config";
import { Client } from "@notionhq/client";
import ical from "node-ical";
import axios from "axios";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const US_DB_ID: string =
  process.env.US_EVENT_NOTION_DB_ID ??
  (() => {
    throw new Error("Missing US_EVENT_NOTION_DB_ID");
  })();
const JP_DB_ID: string =
  process.env.JP_EVENT_NOTION_DB_ID ??
  (() => {
    throw new Error("Missing JP_EVENT_NOTION_DB_ID");
  })();

type IcsSource = { url: string; dbId: string };

const ICS_SOURCES: IcsSource[] = [
  // 미국
  {
    url: "https://calendar.google.com/calendar/ical/ko.usa%23holiday%40group.v.calendar.google.com/public/basic.ics",
    dbId: US_DB_ID,
  },
  // 일본
  {
    url: "https://calendar.google.com/calendar/ical/ko.japanese%23holiday%40group.v.calendar.google.com/public/basic.ics",
    dbId: JP_DB_ID,
  },
];
interface CalendarEvent {
  title: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}
const notion = new Client({ auth: NOTION_TOKEN });

function dateOnly(isoString: string): string {
  return isoString.split("T")[0];
}

// 단일 ICS URL에서 이벤트 파싱
async function fetchEventsFrom(url: string): Promise<CalendarEvent[]> {
  const res = await axios.get(url);
  const parsed = ical.parseICS(res.data);
  return Object.values(parsed)
    .filter((ev) => ev.type === "VEVENT")
    .map((ev) => ({
      title: ev.summary,
      start: dateOnly(ev.start.toISOString()),
      end: dateOnly(ev.end.toISOString()),
    }));
}

// 기존 이벤트 조회
async function getExisting(dbId: string): Promise<CalendarEvent[]> {
  const pages: any = [];
  let cursor: string | undefined;

  do {
    const resp = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor ?? undefined : undefined;
  } while (cursor);

  return pages.map((p: any) => ({
    title: p.properties["이름"].title[0]?.plain_text,
    start: dateOnly(p.properties["날짜"].date.start),
  }));
}

// 전체 ICS 소스 동기화
async function syncAll(): Promise<void> {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;

  for (const { url, dbId } of ICS_SOURCES) {
    console.log(`Syncing ${url} → DB(${dbId}) for year ${currentYear}`);

    const [events, existing] = await Promise.all([
      fetchEventsFrom(url),
      getExisting(dbId),
    ]);

    const existSet = new Set(existing.map((e) => `${e.title}|${e.start}`));

    for (const ev of events) {
      const eventYear = parseInt(ev.start.split("-")[0], 10);
      if (eventYear !== currentYear && eventYear !== nextYear) continue;

      const key = `${ev.title}|${ev.start}`;
      if (!existSet.has(key)) {
        await notion.pages.create({
          parent: { database_id: dbId },
          properties: {
            이름: {
              title: [{ text: { content: ev.title } }],
            },
            날짜: {
              date: { start: ev.start, end: ev.end },
            },
          },
        });
        console.log(`  + Added: ${ev.title} (${ev.start})`);
      }
    }
  }

  console.log("Sync complete.");
}

syncAll().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
