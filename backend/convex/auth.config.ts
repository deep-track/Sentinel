const domain = process.env.AUTH0_DOMAIN?.trim();
const applicationID = process.env.AUTH0_CLIENT_ID?.trim();

if (!domain || !applicationID) {
  throw new Error("AUTH0_DOMAIN and AUTH0_CLIENT_ID must be configured");
}

export default {
  providers: [
    {
      domain: `https://${domain}/`,
      applicationID,
    },
  ],
};
