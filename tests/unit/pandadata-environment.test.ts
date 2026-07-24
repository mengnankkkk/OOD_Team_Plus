import { describe, expect, it } from "vitest";

import {
  getPandadataEnvironment,
  pandadataChildProcessEnvironment,
} from "@/server/advisor/pandadata-environment";

describe("Pandadata environment", () => {
  it("maps project-specific credentials to the SDK environment names", () => {
    const environment = {
      PANDADATA_USERNAME: "8617777777777",
      PANDADATA_PASSWORD: "secret-password",
      PANDADATA_BASE_URL: "https://pandadata.pandaaiquant.com",
    };

    expect(getPandadataEnvironment(environment)).toEqual({
      username: "8617777777777",
      password: "secret-password",
      baseUrl: "https://pandadata.pandaaiquant.com",
      credentialsConfigured: true,
      usernameValid: true,
    });
    expect(pandadataChildProcessEnvironment(environment)).toMatchObject({
      DEFAULT_USERNAME: "8617777777777",
      DEFAULT_PASSWORD: "secret-password",
      JAVA_SERVICE_BASE_URL: "https://pandadata.pandaaiquant.com",
    });
  });

  it("supports the SDK-native environment names without exposing secrets in status", () => {
    const environment = {
      DEFAULT_USERNAME: "8617777777777",
      DEFAULT_PASSWORD: "secret-password",
      JAVA_SERVICE_BASE_URL: "https://pandadata.pandaaiquant.com",
    };
    const config = getPandadataEnvironment(environment);

    expect(config.credentialsConfigured).toBe(true);
    expect(config.usernameValid).toBe(true);
    expect({
      credentialsConfigured: config.credentialsConfigured,
      usernameValid: config.usernameValid,
    }).not.toHaveProperty("password");
  });

  it("uses the SDK 0.0.12 default service URL when no override is provided", () => {
    expect(getPandadataEnvironment({
      PANDADATA_USERNAME: "8617777777777",
      PANDADATA_PASSWORD: "secret-password",
    })).toMatchObject({
      baseUrl: "http://pandadata.pandaaiquant.com",
      credentialsConfigured: true,
    });
  });

  it("does not mark incomplete or malformed credentials as configured", () => {
    expect(getPandadataEnvironment({
      PANDADATA_USERNAME: "17777777777",
      PANDADATA_PASSWORD: "secret-password",
    })).toMatchObject({
      credentialsConfigured: false,
      usernameValid: false,
    });
  });
});
