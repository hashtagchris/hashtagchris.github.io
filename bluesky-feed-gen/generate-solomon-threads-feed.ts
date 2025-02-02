import { AtpAgent } from "npm:@atproto/api";
import {
  getIdentifier,
  getPassword,
  LongformThreadFinder,
} from "./lib/bsky.ts";

// handle: solomonmissouri.bsky.social
const authorDID = "did:plc:w6adnkpcgqb67lqi5nxcy7l5";
const minDepth = 5;

const agent = new AtpAgent({
  service: "https://bsky.social",
});
await agent.login({
  identifier: getIdentifier(),
  password: getPassword(),
});

const threadFinder = new LongformThreadFinder(agent, authorDID, minDepth);
await threadFinder.populateFeedMap();

const rootPosts = threadFinder.getRootPosts();

const feed = rootPosts.map((r) => {
  return { post: r.post.uri };
});

console.log(JSON.stringify({ feed }, undefined, 2));
