const FALLBACK_BOOKING_TIMEZONE = "Europe/Brussels";

interface ZonedDateParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

interface ParsedYmd {
	year: number;
	month: number;
	day: number;
}

interface ParsedHm {
	hour: number;
	minute: number;
}

function parseYmd(value: string): ParsedYmd | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
	if (month < 1 || month > 12) return null;
	if (day < 1 || day > 31) return null;
	return { year, month, day };
}

function parseHm(value: string): ParsedHm | null {
	const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return { hour, minute };
}

function getBookingTimeZone() {
	const raw = String(import.meta.env.BOOKING_TIMEZONE ?? "").trim();
	return raw || FALLBACK_BOOKING_TIMEZONE;
}

function getZonedParts(date: Date, timeZone: string): ZonedDateParts {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23"
	});

	const parts = formatter.formatToParts(date);
	const values: Record<string, string> = {};
	for (const part of parts) {
		if (part.type !== "literal") values[part.type] = part.value;
	}

	return {
		year: Number(values.year ?? "0"),
		month: Number(values.month ?? "0"),
		day: Number(values.day ?? "0"),
		hour: Number(values.hour ?? "0"),
		minute: Number(values.minute ?? "0"),
		second: Number(values.second ?? "0")
	};
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
	const zoned = getZonedParts(date, timeZone);
	const asUtc = Date.UTC(
		zoned.year,
		zoned.month - 1,
		zoned.day,
		zoned.hour,
		zoned.minute,
		zoned.second
	);
	return asUtc - date.getTime();
}

function toUtcTimestampForBookingLocal(dateYmd: string, timeHm: string, second = 0) {
	const parsedDate = parseYmd(dateYmd);
	const parsedTime = parseHm(timeHm);
	if (!parsedDate || !parsedTime) return null;
	if (second < 0 || second > 59) return null;

	const timeZone = getBookingTimeZone();
	const naiveUtc = Date.UTC(
		parsedDate.year,
		parsedDate.month - 1,
		parsedDate.day,
		parsedTime.hour,
		parsedTime.minute,
		second
	);

	let current = naiveUtc;
	for (let index = 0; index < 4; index += 1) {
		const offset = getTimeZoneOffsetMs(new Date(current), timeZone);
		const next = naiveUtc - offset;
		if (next === current) break;
		current = next;
	}

	const check = getZonedParts(new Date(current), timeZone);
	const isExactMatch =
		check.year === parsedDate.year &&
		check.month === parsedDate.month &&
		check.day === parsedDate.day &&
		check.hour === parsedTime.hour &&
		check.minute === parsedTime.minute &&
		check.second === second;

	if (!isExactMatch) return null;
	return current;
}

export function addDaysToYmd(dateYmd: string, days: number) {
	const parsed = parseYmd(dateYmd);
	if (!parsed || !Number.isInteger(days)) return null;
	const noonUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0);
	const next = new Date(noonUtc + days * 24 * 60 * 60 * 1000);
	return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function weekdayFromYmd(dateYmd: string) {
	const parsed = parseYmd(dateYmd);
	if (!parsed) return null;
	return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

export function isoToBookingYmd(iso: string) {
	const value = new Date(iso);
	if (Number.isNaN(value.getTime())) return null;
	const zoned = getZonedParts(value, getBookingTimeZone());
	return `${zoned.year}-${String(zoned.month).padStart(2, "0")}-${String(zoned.day).padStart(2, "0")}`;
}

export function createLocalIso(date: string, time: string) {
	const timestamp = toUtcTimestampForBookingLocal(date, time, 0);
	if (timestamp === null) return null;
	return new Date(timestamp).toISOString();
}

export function getDayBoundaryIso(date: string) {
	const startTimestamp = toUtcTimestampForBookingLocal(date, "00:00", 0);
	if (startTimestamp === null) return null;

	const nextDate = addDaysToYmd(date, 1);
	if (!nextDate) return null;

	const nextStartTimestamp = toUtcTimestampForBookingLocal(nextDate, "00:00", 0);
	if (nextStartTimestamp === null) return null;

	return {
		startIso: new Date(startTimestamp).toISOString(),
		endIso: new Date(nextStartTimestamp - 1).toISOString()
	};
}

export function minutesToTimeLabel(totalMinutes: number) {
	const hours = Math.floor(totalMinutes / 60)
		.toString()
		.padStart(2, "0");
	const minutes = (totalMinutes % 60).toString().padStart(2, "0");
	return `${hours}:${minutes}`;
}

export function dateToLocalYmd(date: Date) {
	const zoned = getZonedParts(date, getBookingTimeZone());
	return `${zoned.year}-${String(zoned.month).padStart(2, "0")}-${String(zoned.day).padStart(2, "0")}`;
}
