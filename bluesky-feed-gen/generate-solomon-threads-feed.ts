import { parseArgs } from "jsr:@std/cli/parse-args";
import { AtpAgent } from "npm:@atproto/api";
import { FeedViewPost } from "@atproto/api";
import {
  getIdentifier,
  getPassword,
  LongformThreadFinder,
} from "./lib/bsky.ts";

const DAY = 24 * 60 * 60 * 1000; // milliseconds in a day

const flags = parseArgs(Deno.args, {
  string: [
    // Optional: Used in place of API calls. Allows for debugging with consistent data.
    "authorFeedFile",
    // The posts that comprise the feed, including text and dates.
    // Opened for read and appending.
    "feedPostsFile",
    // The output feed file, which is a list of post URIs.
    "feedSkeletonFile",
    // The threshold for replies from the author to their own posts.
    "minDepth",
  ],
  default: {
    feedPostsFile: "./data/feed-posts.json",
    feedSkeletonFile: "../docs/xrpc/app.bsky.feed.getFeedSkeleton/index.json",
    minDepth: "5"
  },
});


// handle: solomonmissouri.bsky.social
const authorDID = "did:plc:w6adnkpcgqb67lqi5nxcy7l5";
const minDepth = Number(flags.minDepth);

const agent = new AtpAgent({
  service: "https://bsky.social",
});
await agent.login({
  identifier: getIdentifier(),
  password: getPassword(),
});

const threadFinder = new LongformThreadFinder(agent, authorDID, minDepth);

// retrieve existing feed posts
let feedPosts: FeedViewPost[] = [];
try {
  const feedPostsJson = await Deno.readTextFile(flags.feedPostsFile);
  feedPosts = await JSON.parse(feedPostsJson);
} catch (error) {
  if (error instanceof Deno.errors.NotFound) {
    console.warn(`Could not find feed posts file: ${flags.feedPostsFile}. Starting with an empty feed.`);
  } else {
    console.warn(`Starting with an empty feed. Error reading feed posts file: ${flags.feedPostsFile}: ${error}`);
  }
}

// Determine the cutoff for fetching recent posts.
const opts: {since?: Date} = {};
if (feedPosts.length > 0) {
  const threeDaysAgo = new Date(Date.now() - DAY * 3);
  const latestPostDate = new Date(feedPosts[0].post.record.createdAt);
  console.log(`Latest post date: ${latestPostDate.toISOString()}`);

  if (latestPostDate < threeDaysAgo) {
    opts.since = latestPostDate;
  } else {
    opts.since = threeDaysAgo;
  }
}

// Populate a map with recent posts from the author's feed.
if (flags.authorFeedFile) {
  // using a local file allows for debugging with consistent data
  await threadFinder.populateFeedMapFromFile(flags.authorFeedFile, opts);
} else {
  await threadFinder.populateFeedMapFromAPI(opts);
}

// Get recent posts that meet the critieria for the feed
const recentFeedPosts: FeedViewPost[] = threadFinder.getRootPosts();

// Filter out posts already in the feed
const feedPostsToAdd = recentFeedPosts.filter((post) => {
  // filter out posts that are already in the feedPosts
  return !feedPosts.some((p) => p.post.uri === post.post.uri);
});

console.log(`Out of ${recentFeedPosts.length} recent posts eligible for the feed, ${feedPostsToAdd.length} are new.`);

// Add the new posts to the feed
feedPosts.unshift(...feedPostsToAdd);

// Write the updated feed posts to the file
await Deno.writeTextFile(flags.feedPostsFile, JSON.stringify(feedPosts, undefined, 2));

// Create the feed skeleton with the URIs of the posts
const feed = feedPosts.map((r: FeedViewPost) => {
  return { post: r.post.uri };
});

// Write the feed skeleton to the output file
await Deno.writeTextFile(flags.feedSkeletonFile, JSON.stringify({ feed }, undefined, 2));
