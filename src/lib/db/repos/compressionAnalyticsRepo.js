// Facade — path-stable entry point for compression analytics.
import * as sqlite from "./sqlite/compressionAnalyticsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("./mysql/compressionAnalyticsRepo.js"));

export const getCompressionAnalyticsSummary = bound.getCompressionAnalyticsSummary;
