import { type ClassValue, clsx } from "clsx";
import { isValidPhoneNumber } from "libphonenumber-js";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function checkPhoneNumber(phoneNumber: string): boolean {
	return isValidPhoneNumber(phoneNumber);
}