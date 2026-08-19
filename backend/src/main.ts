import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { ApplicationLive } from "./http/live.ts";

Layer.launch(ApplicationLive).pipe(NodeRuntime.runMain);
