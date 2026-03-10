export function createLocalIso(date: string, time: string) {
	const raw = `${date}T${time}:00`;
	const value = new Date(raw);
	if (Number.isNaN(value.getTime())) return null;
	return value.toISOString();
}

export function getDayBoundaryIso(date: string) {
	const start = new Date(`${date}T00:00:00`);
	const end = new Date(`${date}T23:59:59`);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
		return null;
	}
	return {
		startIso: start.toISOString(),
		endIso: end.toISOString()
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
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
