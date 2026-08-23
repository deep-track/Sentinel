"use server"

import { findUser } from "@/backend/actions/auth-actions"
import { getAuth } from "@/backend/lib/auth"
import { revalidateTag } from "next/cache"
import {redirect} from "next/navigation"

interface UploadedImages {
  face_Image: string;
  front_id_Image: string;
  back_id_Image: string;
}

export async function createApiKey() {
    const { userId } = await getAuth();
    if (!userId) return redirect("/auth/login");

    try {
        const data = await findUser(userId);

        if (!data) {
            throw new Error("User not found or invalid response");
        }

        const response = await fetch(
            `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/api-keys`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: "Generated API Key",
                }),
            }
        );

        if (!response.ok) throw new Error("Failed to create API key");

        revalidateTag("apikeys");
        const responseData = await response.json();
        return { success: true, apiKey: responseData.data?.key };

    } catch (error) {
        console.error("Error:", error);
        return { success: false, error: (error as Error).message };
    }
}

export async function getApiKeys() {
    const { userId } = await getAuth();
    if (!userId) return redirect("/auth/login");

    try {
      const response = await fetch(
            `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/api-keys`,
            {
              method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
                next: { tags: ['apikeys'] }
            }
        )

        if (!response.ok) return [];
        const responseData = await response.json();

        return responseData;
    } catch (error) {
        console.error("API Error:", error)
        return []
    }
}



export async function verifyIdentityServerSide(uploadedImages: UploadedImages) {
    const { userId } = await getAuth();
				if (!userId) return redirect("/auth/login");

				try {
					const userData = await findUser(userId);
					if (!userData) {
						throw new Error("User not found");
					}

					const apiKeys = await getApiKeys();

					// get the active DeepTrack API key
					const deepTrackKey =
						apiKeys.find((key: any) => key.status === "Active")
							?.apiKey ||
						apiKeys.find((key: any) => key.status === "Active")
							?.key;

					if (!deepTrackKey) {
						throw new Error(
							"DeepTrack API key not found. Please create one first.",
						);
					}

					// Make the API request with proper credentials
					const response = await fetch(
						`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/kyc/verify`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"x-api-key": deepTrackKey,
							},
							body: JSON.stringify(uploadedImages),
						},
					);

					const data = await response.json();

					return { success: true, data };
				} catch (error) {
					console.error("Verification error:", error);
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Unknown verification error",
					};
				}
}