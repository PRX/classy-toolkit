import { get, request } from "node:https";

const { CLASSY_API_CLIENT_ID, CLASSY_API_CLIENT_SECRET } = process.env;

function getAccessToken() {
  return new Promise((resolve, reject) => {
    const body = `grant_type=client_credentials&client_id=${CLASSY_API_CLIENT_ID}&client_secret=${CLASSY_API_CLIENT_SECRET}`;

    const options = {
      host: "api.classy.org",
      path: `/oauth2/auth`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = request(options, (res) => {
      res.setEncoding("utf8");

      let json = "";
      res.on("data", (chunk) => {
        json += chunk;
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const payload = JSON.parse(json);
          resolve(payload.access_token);
        } else {
          reject(new Error(`Classy token request failed! ${res.statusCode}`));
        }
      });
    });

    // Generic request error handling
    req.on("error", (e) => reject(e));

    req.write(body);
    req.end();
  });
}

/**
 * @param {string} token
 * @param {string} path
 * @returns {any}
 */
function httpGet(token, path) {
  return new Promise((resolve, reject) => {
    const options = {
      host: "api.classy.org",
      path: `/2.0${path}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    const req = get(options, (res) => {
      res.setEncoding("utf8");

      let json = "";
      res.on("data", (chunk) => {
        json += chunk;
      });
      res.on("end", () => {
        try {
          const resPayload = JSON.parse(json);
          resolve(resPayload);
        } catch (e) {
          console.error("Error handling JSON response!");
          reject(e);
        }
      });
    });

    // Generic request error handling
    req.on("error", (e) => reject(e));
  });
}

export const handler = async () => {
  const token = await getAccessToken();

  const payload = await httpGet(token, "/campaigns/861695/overview");
  console.log(JSON.stringify(payload));

  return { donors_count: payload.donors_count };
};
