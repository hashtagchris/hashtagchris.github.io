import { AtpAgent } from "npm:@atproto/api";
import {
  getIdentifier,
  getPassword,
  LongformThreadFinder,
} from "./lib/bsky.ts";

// handle: solomonmissouri.bsky.social
const authorDID = "did:plc:w6adnkpcgqb67lqi5nxcy7l5";
const minDepth = 5;

const authorFeedFile = Deno.args.length > 0 ? Deno.args[0] : undefined;

const agent = new AtpAgent({
  service: "https://bsky.social",
});
await agent.login({
  identifier: getIdentifier(),
  password: getPassword(),
});

const threadFinder = new LongformThreadFinder(agent, authorDID, minDepth);

// using a local file allows for debugging with consistent data
if (authorFeedFile) {
  await threadFinder.populateFeedMapFromFile(authorFeedFile);
} else {
  await threadFinder.populateFeedMapFromAPI();
}

const rootPosts = threadFinder.getRootPosts();

const feed = rootPosts.map((r) => {
  return { post: r.post.uri };
});

console.log(JSON.stringify({ feed }, undefined, 2));
