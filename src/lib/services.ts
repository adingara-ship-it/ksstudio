export interface ServiceOption {
	code: string;
	name: string;
	durationMinutes: number;
	priceLabel: string;
}

export const SERVICE_OPTIONS: ServiceOption[] = [
	{
		code: "pose-complete-french-babyboomer",
		name: "Pose complète French / babyboomer",
		durationMinutes: 120,
		priceLabel: "45 EUR"
	},
	{
		code: "gel-vsp-gel-simple",
		name: "Gel + VSP / Gel simple",
		durationMinutes: 95,
		priceLabel: "40 EUR"
	},
	{
		code: "biab",
		name: "BIAB",
		durationMinutes: 75,
		priceLabel: "35 EUR"
	},
	{
		code: "depose-manucure",
		name: "Dépose + manucure",
		durationMinutes: 45,
		priceLabel: "15 EUR"
	}
];

export function getServiceByCode(code: string) {
	return SERVICE_OPTIONS.find((service) => service.code === code) ?? null;
}
