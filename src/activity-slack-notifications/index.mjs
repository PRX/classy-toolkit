/* eslint-disable no-await-in-loop */
/* eslint-disable camelcase */
/* eslint-disable no-underscore-dangle */
import * as https from "node:https";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

const eventbridge = new EventBridgeClient({ apiVersion: "2015-10-07" });

const { CLASSY_API_CLIENT_ID, CLASSY_API_CLIENT_SECRET } = process.env;
const POLLING_FREQUENCY = +process.env.POLLING_FREQUENCY;

const mapping = {
  338429: "#radiotopia-donations",
  336384: "#radiotopia-donations",
  330330: "#radiotopia-donations",
  330245: "#radiotopia-donations",
  342678: "#radiotopia-donations",
  327574: "#radiotopia-donations",
  386768: "#radiotopia-donations",
  389319: "#radiotopia-donations",
  404463: "#radiotopia-donations",
  431111: "#radiotopia-donations",
  435498: "#radiotopia-donations",
  464573: "#radiotopia-donations",
  532478: "#radiotopia-donations",
  326353: "#earhustle-donations",
  399428: "#earhustle-donations",
  400513: "#earhustle-donations",
  431058: "#earhustle-donations",
  431079: "#earhustle-donations",
  479496: "#earhustle-donations",
  483297: "#earhustle-donations",
  484673: "#earhustle-donations",
  368624: "#tw-donations",
  368561: "#tw-donations",
  368367: "#tw-donations",
  409824: "#tw-donations",
  376564: "#tw-donations",
  376559: "#tw-donations",
  437935: "#tw-donations",
  324469: "#tw-donations",
  630896: "#tw-donations",
  489555: "#ygap-donations",
  // 999999: '#tw-donations',
};

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

    const req = https.request(options, (res) => {
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

    const req = https.get(options, (res) => {
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

function shortMemberName(member, tx) {
  if (tx.is_anonymous) {
    return `_Anonymous_`;
  }

  return `${member?.first_name} ${member?.last_name.charAt(0)}.`;
}

function campaignUrl(campaign) {
  return `https://www.classy.org/manage/event/${campaign.id}/overview`;
}

function transactionLocation(tx) {
  let location = "";

  const city = tx?.metadata?._classy_pay?.payer?.city;
  const state = tx?.metadata?._classy_pay?.payer?.state;
  const country = tx?.metadata?._classy_pay?.payer?.country;

  const locationParts = [];
  if (city) locationParts.push(city);
  if (state) locationParts.push(state);
  if (country) locationParts.push(country);

  if (city || state || country) {
    location = ` (${locationParts.join(", ")})`;
  }
  return location;
}

function transactionUrl(transaction) {
  return `https://www.classy.org/admin/72482/transactions/${transaction.id}`;
}

function moneyAmountString(transaction) {
  const currency =
    transaction?.metadata?._classy_pay?.transaction?.currency ||
    transaction.currency_code;
  const rawAmount =
    transaction?.metadata?._classy_pay?.transaction?.amount ||
    transaction.raw_donation_gross_amount;
  const amount = (+rawAmount).toFixed(2);

  let money;
  if (currency === "USD") {
    money = `$${amount}`;
  } else if (currency === "GBP") {
    money = `£${amount}`;
  } else if (currency === "CAD") {
    money = `CA$${amount}`;
  } else if (currency === "EUR") {
    money = `€${amount}`;
  } else {
    money = `${amount} ${currency}`;
  }

  if (
    transaction?.metadata?._classy_pay?.transaction?.chargeCurrency &&
    transaction?.metadata?._classy_pay?.transaction?.chargeAmount &&
    transaction?.metadata?._classy_pay?.transaction?.chargeCurrency !== currency
  ) {
    const t = transaction?.metadata?._classy_pay?.transaction;
    // eslint-disable-next-line no-unsafe-optional-chaining
    const ca = +t?.chargeAmount;
    const cc = t?.chargeCurrency;

    if (cc === "USD") {
      money = `${money} ($${ca.toFixed(2)})`;
    } else {
      money = `${money} (${ca.toFixed(2)} ${cc})`;
    }
  }

  return money;
}

export const handler = async () => {
  let icon_emoji = ":classy:";
  let username = "Classy";

  const token = await getAccessToken();

  const payload = await httpGet(token, `/organizations/72482/activity`);

  const now = new Date();
  const threshold = +now - POLLING_FREQUENCY * 60 * 1000;
  // const threshold = +now - 6 * 60 * 1000;

  // eslint-disable-next-line no-restricted-syntax
  for (const activity of payload.data) {
    if (activity.campaign) {
      let text;
      const camp = activity.campaign;

      if (activity.type === "donation_created") {
        const tx = activity.transaction;
        const mem = activity.member;

        const ts = Date.parse(activity.created_at);

        // Only process transactions from the campaigns we care about, since
        // the last time the the poller ran
        if (ts >= threshold) {
          const comment = tx.comment?.length ? `\n> ${tx.comment}` : "";
          text = "";

          // For transactions that are part of the recurring donation plan,
          // if the transaction date is after the plan's start date, we ignore
          // the activity. We only care about the initial transaction for
          // recurring plans.
          if (tx?.metadata?._classy_pay?.transaction?.metaData?.planId) {
            const rdpId = tx.metadata._classy_pay.transaction.metaData.planId;
            const recPlan = await httpGet(
              token,
              `/recurring-donation-plans/${rdpId}`,
            );

            // This is when the transaction actually started, which could be days
            // before the activity showed up (like with ACH transactions).
            const txCreatedDate =
              tx?.metadata?._classy_pay?.transaction?.createdDate;

            // This is midnight of the day the plan started
            const recPlanStartedDate = recPlan?.started_at;

            if (txCreatedDate && recPlanStartedDate) {
              const txDate = txCreatedDate.slice(0, 10);
              const planDate = recPlanStartedDate.slice(0, 10);

              // Compare the YYYY-MM-DD dates
              if (txDate > planDate) {
                console.log("Skipping recurring donation plan activity");
                text = text.concat(":recycle:");
                // eslint-disable-next-line no-continue
                continue;
              }
            }
          }

          // const fullTx = await httpGet(`/transactions/${tx.id}`);

          const name = shortMemberName(mem, tx);
          const campUrl = campaignUrl(camp);
          const txUrl = transactionUrl(tx);
          // const supporterUrl = `https://www.classy.org/admin/72482/supporters/${fullTx.supporter_id}`;

          const money = moneyAmountString(tx);
          const moneyAmt = parseFloat(money.match(/[0-9]+\.[0-9]+/g).at(-1));

          const location = transactionLocation(tx);

          if (tx.frequency === "one-time") {
            text = text.concat(
              `*${name}*${location} made a <${txUrl}|${money}> donation to the <${campUrl}|${camp.name}> campaign${comment}`,
            );

            if (moneyAmt >= 100) {
              icon_emoji = ":classy-alt:";
              username = "Classy!";
            }
          } else {
            text = text.concat(
              `*${name}*${location} created a new ${tx.frequency} recurring giving plan for the <${campUrl}|${camp.name}> campaign for <${txUrl}|${money}>${comment}`,
            );

            if (moneyAmt >= 33) {
              icon_emoji = ":classy-alt:";
              username = "Classy!";
            }
          }
        }
      } else if (activity.type === "ticket_purchased") {
        const tx = activity.transaction;
        const mem = activity.member;

        const location = transactionLocation(tx);

        const ts = Date.parse(activity.created_at);

        // Only process transactions from the campaigns we care about, since
        // the last time the the poller ran
        if (ts >= threshold) {
          const name = shortMemberName(mem);
          const campUrl = campaignUrl(camp);
          const txUrl = transactionUrl(tx);

          const money = moneyAmountString(tx);

          const comment = tx.comment?.length ? `\n> ${tx.comment}` : "";
          text = `:admission_tickets: *${name}*${location} selected a <${txUrl}|${money}> reward from the <${campUrl}|${camp.name}> campaign${comment}`;
        }
      }

      if (text) {
        if (mapping[camp.id]) {
          await eventbridge.send(
            new PutEventsCommand({
              Entries: [
                {
                  Source: "org.prx.classy-toolkit",
                  DetailType: "Slack Message Relay Message Payload",
                  Detail: JSON.stringify({
                    channel: mapping[camp.id],
                    username,
                    icon_emoji,
                    text,
                  }),
                },
              ],
            }),
          );
        }

        await eventbridge.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: "org.prx.classy-toolkit",
                DetailType: "Slack Message Relay Message Payload",
                Detail: JSON.stringify({
                  channel: "C0596MWU6UV", // #resdev-donations
                  username,
                  icon_emoji,
                  text,
                }),
              },
            ],
          }),
        );
      }
    }
  }
};
