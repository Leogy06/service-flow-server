import pino from "pino";

export const logger = pino(
  process.env.NODE_ENV === "test"
    ? { level: "silent" }
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      },
);
