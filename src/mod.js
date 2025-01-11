"use strict";
const fs = require("fs");
const path = require("path");

class RestrictFlea {

    constructor() {
        this.CFG = require("../config/config.json");
        this.restrictedProfilesFile = path.resolve(__dirname, "restrictedProfiles.json");
    }

    preSptLoad(container) {
        const RouterService = container.resolve("StaticRouterModService");
        const logger = container.resolve("WinstonLogger");

        RouterService.registerStaticRouter("CheckForSession", [{
            url: "/launcher/profile/info",
            action: async (url, info, sessionId, output) => {
                //logger.log(`Received request for profile info. Session ID: ${sessionId}`);
                this.checkSessionRestriction(sessionId, logger, container);
                return output;
            }
        }], "aki");

        RouterService.registerStaticRouter("CheckForNewProfile", [{
            url: "/launcher/profile/register",
            action: async (url, info, sessionId, output) => {
                const restrictedProfiles = this.loadRestrictedProfiles();

                if (!restrictedProfiles[sessionId]) {
                    restrictedProfiles[sessionId] = {
                        restrictedUntil: Date.now() + this.CFG.durationInDays * 24 * 60 * 60 * 1000
                    };
                    this.saveRestrictedProfiles(restrictedProfiles);

                    logger.log(`[Restrict Flea] Freshly created profile was flea market restricted. Profile ID: ${sessionId}`, "cyan");
                } else {
                    logger.log(`[Restrict Flea] Profile already restricted. Profile ID: ${sessionId}`, "yellow");
                }

                return output;
            }
        }], "aki");

        RouterService.registerStaticRouter("CheckForProfileWipe", [{
            url: "/launcher/profile/change/wipe",
            action: async (url, info, sessionId, output) => {
                const restrictedProfiles = this.loadRestrictedProfiles();

                if (!restrictedProfiles[sessionId]) {
                    restrictedProfiles[sessionId] = {
                        restrictedUntil: Date.now() + this.CFG.durationInDays * 24 * 60 * 60 * 1000
                    };
                    this.saveRestrictedProfiles(restrictedProfiles);

                    logger.log(`[Restrict Flea] Profile was wiped and flea market restricted. Profile ID: ${sessionId}`, "cyan");
                } else {
                    logger.log(`[Restrict Flea] Profile already restricted. Profile ID: ${sessionId}`, "yellow");
                }

                return output;
            }
        }], "aki");
    }

    postDBLoad(container) {
        const db = container.resolve("DatabaseServer");
        const tables = db.getTables();
        const globals = tables.globals.config;
        const { CFG: config } = this;

        const logger = container.resolve("WinstonLogger");

        if (!config.enabled) {
            logger.log("[Restrict Flea] Flea temporary restrictions are disabled in the config but flea market level cap was set.", "yellow");
            globals.RagFair.minUserLevel = config.restrictedLevel;
            return;
        } else {
            this.checkAndRestrictProfiles(logger, config);
        }
    }

    checkSessionRestriction(sessionId, logger, container) {
        const db = container.resolve("DatabaseServer");
        const tables = db.getTables();
        const globals = tables.globals.config;
        const { CFG: config } = this;
        const restrictedProfiles = this.loadRestrictedProfiles();

        if (restrictedProfiles[sessionId]) {
            const restriction = restrictedProfiles[sessionId];
            const timeRemaining = restriction.restrictedUntil - Date.now();

            if (timeRemaining > 0) {
                const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
                const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
                logger.log(`[Restrict Flea] Profile ${sessionId} is flea restricted. Time until unlock: ${hours} hours and ${minutes} minutes.`, "cyan");
                globals.RagFair.minUserLevel = 99;
            } else {
                logger.log(`[Restrict Flea] Restriction expired for session: ${sessionId}`, "green");
                delete restrictedProfiles[sessionId];
                this.saveRestrictedProfiles(restrictedProfiles);
                globals.RagFair.minUserLevel = config.restrictedLevel;
            }
        } else {
            // Profile has no restrictions
            globals.RagFair.minUserLevel = config.restrictedLevel;
        }
    }

    checkAndRestrictProfiles(logger, config) {
        const profilesDir = path.resolve(__dirname, "../../../profiles");
        const restrictedProfiles = this.loadRestrictedProfiles();
        const profileFiles = fs.readdirSync(profilesDir).filter(file => file.endsWith(".json"));

        profileFiles.forEach(file => {
            const filePath = path.join(profilesDir, file);
            const profileId = path.basename(file, ".json");
            const profileData = JSON.parse(fs.readFileSync(filePath, "utf8"));

            const registrationDate = profileData?.characters?.pmc?.Info?.RegistrationDate;
            const accountAgeInDays = (Date.now() / 1000 - registrationDate) / (60 * 60 * 24);

            if (accountAgeInDays > config.durationInDays) {
                logger.log(`[Restrict Flea] Profile ${profileId} is older than ${config.durationInDays} days. No temporary restriction applied.`, "green");
                return;
            }

            // If we find a new profile add restriction
            if (!restrictedProfiles[profileId]) {
                restrictedProfiles[profileId] = {
                    restrictedUntil: Date.now() + config.durationInDays * 24 * 60 * 60 * 1000
                };
                logger.log(`[Restrict Flea] Added restriction for profile: ${profileId}`, "cyan");
            }
        });

        // Update restrictions and save
        for (const [profileId, data] of Object.entries(restrictedProfiles)) {
            const timeRemaining = data.restrictedUntil - Date.now();

            // Restriction expired
            if (timeRemaining <= 0) {
                logger.log(`[Restrict Flea] Restriction expired for profile: ${profileId}`, "cyan");
                delete restrictedProfiles[profileId];
            } else {
                const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
                const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
                logger.log(`[Restrict Flea] Profile ${profileId} restricted. Time remaining: ${hours} hours and ${minutes} minutes.`, "cyan");
            }
        }

        this.saveRestrictedProfiles(restrictedProfiles);
    }

    // Storing our restricted profiles
    loadRestrictedProfiles() {
        if (fs.existsSync(this.restrictedProfilesFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.restrictedProfilesFile, "utf8"));
            } catch (err) {
                logger.log("[Restrict Flea] Failed to load restricted profiles file!", "red");
            }
        }
        return {};
    }

    saveRestrictedProfiles(data) {
        try {
            fs.writeFileSync(this.restrictedProfilesFile, JSON.stringify(data, null, 4), "utf8");
        } catch (err) {
            logger.log("[Restrict Flea] Failed to save restricted profiles file!", "red");
        }
    }
}

exports.mod = new RestrictFlea();
