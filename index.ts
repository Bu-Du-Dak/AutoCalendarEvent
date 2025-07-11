import "dotenv/config";
import { Client } from "@notionhq/client";
import ical from "node-ical";
import axios from "axios";
import { subDays } from "date-fns";

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const US_DB_ID = process.env.US_EVENT_NOTION_DB_ID!;
const JP_DB_ID = process.env.JP_EVENT_NOTION_DB_ID!;
const notion = new Client({ auth: NOTION_TOKEN });

interface IcsSource {
  url: string;
  dbId: string;
}
interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
}

const ICS_SOURCES: IcsSource[] = [
  {
    url: "https://calendar.google.com/calendar/ical/ko.usa%23holiday%40group.v.calendar.google.com/public/basic.ics",
    dbId: US_DB_ID,
  },
  {
    url: "https://calendar.google.com/calendar/ical/ko.japanese%23holiday%40group.v.calendar.google.com/public/basic.ics",
    dbId: JP_DB_ID,
  },
];

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchEventsFrom(url: string): Promise<CalendarEvent[]> {
  const res = await axios.get(url);
  const parsed = ical.parseICS(res.data);
  return Object.values(parsed)
    .filter((ev) => ev.type === "VEVENT")
    .map((ev) => ({
      title: ev.summary,
      start: ev.start as Date,
      end: ev.end as Date,
    }));
}

async function syncAll() {
  const current = new Date().getFullYear();
  const next = current + 1;

  for (const { url, dbId } of ICS_SOURCES) {
    console.log(`Sync ${url} → DB(${dbId})`);

    const raw = await fetchEventsFrom(url);

    const events = raw.filter((ev) => {
      const y = ev.start.getFullYear();
      return y === current || y === next;
    });

    // 기존 일정 불러오기
    const pages: any[] = [];
    let cursor: string | undefined;
    do {
      const r = await notion.databases.query({
        database_id: dbId,
        start_cursor: cursor,
        page_size: 100,
      });
      pages.push(...r.results);
      cursor = r.has_more ? r.next_cursor! : undefined;
    } while (cursor);

    const existSet = new Set(
      pages.map((p) => {
        const t = p.properties["이름"].title[0]?.plain_text;
        const s = p.properties["날짜"].date.start;
        return `${t}|${s}`;
      })
    );

    for (const ev of events) {
      const sd = formatDate(ev.start);

      const ed = formatDate(subDays(ev.end, 1));

      const key = `${ev.title}|${sd}`;
      if (!existSet.has(key)) {
        await notion.pages.create({
          parent: { database_id: dbId },
          properties: {
            이름: { title: [{ text: { content: ev.title } }] },
            날짜: { date: { start: sd, end: ed } },
          },
        });
        console.log(`  + Added: ${ev.title} (${sd} ~ ${ed})`);
      }
    }
  }
  console.log("Done.");
}

syncAll().catch((e) => {
  console.error(e);
  process.exit(1);
});
