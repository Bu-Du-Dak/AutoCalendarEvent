import "dotenv/config";
import { Client } from "@notionhq/client";
import ical from "node-ical";
import axios from "axios";
import { subDays } from "date-fns";
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const US_DB_ID = process.env.US_EVENT_NOTION_DB_ID;
const JP_DB_ID = process.env.JP_EVENT_NOTION_DB_ID;
const notion = new Client({ auth: NOTION_TOKEN });
const ICS_SOURCES = [
    {
        url: "https://calendar.google.com/calendar/ical/ko.usa%23holiday%40group.v.calendar.google.com/public/basic.ics",
        dbId: US_DB_ID,
    },
    {
        url: "https://calendar.google.com/calendar/ical/ko.japanese%23holiday%40group.v.calendar.google.com/public/basic.ics",
        dbId: JP_DB_ID,
    },
];
/** Date → "YYYY-MM-DD" */
function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
/** ICS VEVENT을 Date 객체로 파싱 (start, end는 Date 타입) */
async function fetchEventsFrom(url) {
    const res = await axios.get(url);
    const parsed = ical.parseICS(res.data);
    return Object.values(parsed)
        .filter((ev) => ev.type === "VEVENT")
        .map((ev) => ({
        title: ev.summary,
        start: ev.start,
        end: ev.end,
    }));
}
async function syncAll() {
    const current = new Date().getFullYear();
    const next = current + 1;
    for (const { url, dbId } of ICS_SOURCES) {
        console.log(`Sync ${url} → DB(${dbId})`);
        const raw = await fetchEventsFrom(url);
        // start/end Date 객체 모두 활용
        const events = raw.filter((ev) => {
            const y = ev.start.getFullYear();
            return y === current || y === next;
        });
        // 기존 일정 불러오기
        const pages = [];
        let cursor;
        do {
            const r = await notion.databases.query({
                database_id: dbId,
                start_cursor: cursor,
                page_size: 100,
            });
            pages.push(...r.results);
            cursor = r.has_more ? r.next_cursor : undefined;
        } while (cursor);
        const existSet = new Set(pages.map((p) => {
            const t = p.properties["이름"].title[0]?.plain_text;
            const s = p.properties["날짜"].date.start; // "YYYY-MM-DD"
            return `${t}|${s}`;
        }));
        // 이벤트마다 DTEND(exclusive)에서 하루 빼고, start/end 모두 YYYY-MM-DD 로 포맷
        for (const ev of events) {
            const sd = formatDate(ev.start);
            // DTEND가 exclusive 이므로 하루 전으로 보정
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
