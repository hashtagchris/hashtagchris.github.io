import { AtpAgent } from "npm:@atproto/api";
import { FeedViewPost } from "@atproto/api";

export function getIdentifier() {
  const password = Deno.env.get("BSKY_IDENTIFIER");
  if (!password) {
    throw new Error(
      "BSKY_IDENTIFIER not defined. Did you add it to an .env file and use Deno --env-file?",
    );
  }
  return password;
}

export function getPassword() {
  const password = Deno.env.get("BSKY_APP_PASSWORD");
  if (!password) {
    throw new Error(
      "BSKY_APP_PASSWORD not defined. Did you add it to an .env file and use Deno --env-file?",
    );
  }
  return password;
}

// export type FeedMap = { [key: string]: FeedViewPost };
export type FeedMap = Map<string, FeedViewPost>;

export class LongformThreadFinder {
  agent: AtpAgent;
  authorDID: string;
  minDepth: number;
  feedMap: FeedMap | undefined;

  constructor(agent: AtpAgent, authorDID: string, minDepth: number) {
    this.agent = agent;
    this.authorDID = authorDID;
    this.minDepth = minDepth;
  }

  async populateFeedMap() {
    this.feedMap = new Map<string, FeedViewPost>();

    let cursor: string | undefined;
    let i = 0;
    do {
      const { data } = await this.agent.getAuthorFeed({
        actor: this.authorDID,
        filter: "posts_and_author_threads",
        limit: 100,
        cursor,
      });
      cursor = data.cursor;

      for (const feedView of data.feed) {
        // filter out reposts
        if (feedView.post.author.did === this.authorDID) {
          this.feedMap.set(feedView.post.uri, feedView);
        }
      }

      if (i++ > 1000) {
        break;
      }
    } while (cursor);
  }

  getRootPosts(): FeedViewPost[] {
    if (!this.feedMap) {
      throw new Error("call populateFeedMap first");
    }

    const rootFeeds = new Set<FeedViewPost>();

    for (const feedView of this.feedMap.values()) {
      const result = this.getRootAndDepth(feedView.post.uri, 1);
      if (result && result.depth >= this.minDepth) {
        rootFeeds.add(result.rootFeed);
      }
    }

    const sortedFeeds = [...rootFeeds.values()].toSorted((a, b) =>
      b.post.record.createdAt.localeCompare(a.post.record.createdAt)
    );
    return sortedFeeds;
  }

  getRootAndDepth(
    postURI: string,
    depth: number,
  ): { rootFeed: FeedViewPost; depth: number } | undefined {
    if (!this.feedMap) {
      throw new Error("call populateFeedMap first");
    }

    const feed = this.feedMap.get(postURI);

    if (!feed) {
      return undefined;
    }

    if (!feed.reply) {
      return { rootFeed: feed, depth };
    }

    return this.getRootAndDepth(feed.reply.parent.uri, depth + 1);
  }
}
