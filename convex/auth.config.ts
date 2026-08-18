export default {
  providers: [
    {
      domain: `https://${process.env.AUTH0_DOMAIN}/`,
      applicationID: process.env.AUTH0_CLIENT_ID,
    },
  ],
}; 