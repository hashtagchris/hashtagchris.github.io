import { AtpAgent } from "npm:@atproto/api";
import { FeedViewPost } from "@atproto/api";

// api used:
// https://docs.bsky.app/docs/tutorials/viewing-feeds#author-feeds
// https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed

// posts_and_author_threads is inconsistent about how many author replies it returns.
// Hopefully posts_with_replies will allow us to determine true author-thread depth.
const AuthorFeedFilter = "posts_with_replies";

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

export type SlimPostView = {
  "post": {
    "uri": string;
    "author": {
      "did": string;
      "handle": string;
    };
    "record": {
      "$type": string;
      "createdAt": string;
      "text": string;
    };
    "indexedAt": string;
  };
  "reason"?: {
    "$type": string;
    "indexedAt": string;
  };
  "reply"?: {
    "root": {
      "$type": string;
      "uri": string;
      "author": {
        "did": string;
        "handle": string;
      };
    };
    "parent": {
      "$type": string;
      "uri": string;
      "author": {
        "did": string;
        "handle": string;
      };
    };
  };
};

export type AuthorFeedSlim = {
  page: number;
  feedCount: number;
  feed: SlimPostView[];
  cursor: string | undefined;
}[];

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

  async populateFeedMapFromFile(
    authorFeedFile: string,
    { since }: { since?: Date } = {},
  ) {
    const json = await Deno.readTextFile(authorFeedFile);
    const feedResponses: AuthorFeedSlim = JSON.parse(json);

    this.feedMap = new Map<string, FeedViewPost>();

    let lastPostDate: Date | undefined;
    for (const resp of feedResponses) {
      this.#debug(`processing page ${resp.page}...`);

      for (const feedView of resp.feed) {
        // ignore all reposts, even the author reposting themselves
        if (feedView.reason?.$type === "app.bsky.feed.defs#reasonRepost") {
          continue;
        }
        if (feedView.post.author.did !== this.authorDID) {
          this.#debug(
            `${feedView.post.uri} isn't by the author, and isn't a repost`,
          );
          continue;
        }

        this.feedMap.set(feedView.post.uri, feedView);
        lastPostDate = new Date(feedView.post.record.createdAt);
      }

      if (lastPostDate && since && lastPostDate < since) {
        this.#debug(
          `Stopping at page ${resp.page} because the last post date ${lastPostDate.toISOString()} is before ${since.toISOString()}`,
        );
        break;
      }
    }

    this.#debug(`${this.feedMap.size} entries added to the feedMap`);
  }

  async populateFeedMapFromAPI({ since }: { since?: Date } = {}) {
    this.feedMap = new Map<string, FeedViewPost>();

    let cursor: string | undefined;
    let page = 0;
    let lastPostDate: Date | undefined;
    do {
      const { data } = await this.agent.getAuthorFeed({
        actor: this.authorDID,
        filter: AuthorFeedFilter,
        limit: 100,
        cursor,
      });
      cursor = data.cursor;

      for (const feedView of data.feed) {
        // ignore all reposts, even the author reposting themselves
        if (feedView.reason?.$type === "app.bsky.feed.defs#reasonRepost") {
          continue;
        }
        if (feedView.post.author.did !== this.authorDID) {
          this.#debug(
            `${feedView.post.uri} isn't by the author, and isn't a repost`,
          );
          continue;
        }

        this.feedMap.set(feedView.post.uri, feedView);
        // @ts-ignore record type unknown
        lastPostDate = new Date(feedView.post.record.createdAt);
      }

      if (++page >= 1000) {
        this.#debug("Reached the max page limit");
        break;
      }

      if (lastPostDate && since && lastPostDate < since) {
        this.#debug(
          `Stopping at page ${page} because the last post date ${lastPostDate.toISOString()} is before ${since.toISOString()}`,
        );
        break;
      }
    } while (cursor);

    this.#debug(`${this.feedMap.size} entries added to the feedMap`);
  }

  // for debugging (checking if Bluesky sometimes leaves out some posts, or if we're not paging right)
  async getAuthorFeedSlim(maxPages: number): Promise<AuthorFeedSlim> {
    const results = [];

    let cursor: string | undefined;
    let page = 0;
    do {
      const { data } = await this.agent.getAuthorFeed({
        actor: this.authorDID,
        filter: AuthorFeedFilter,
        limit: 100,
        cursor,
      });
      cursor = data.cursor;

      page++;

      const slimFeed = data.feed.map((f: FeedViewPost) => {
        const slim: SlimPostView = {
          post: {
            uri: f.post.uri,
            author: {
              did: f.post.author.did,
              handle: f.post.author.handle,
            },
            record: {
              // @ts-ignore record type unknown
              $type: f.post.record.$type,
              // @ts-ignore record type unknown
              createdAt: f.post.record.createdAt,
              // @ts-ignore record type unknown
              text: f.post.record.text,
            },
            indexedAt: f.post.indexedAt,
          },
        };

        if (f.reason) {
          slim.reason = {
            // @ts-ignore reason.$type unknown
            $type: f.reason.$type,
            // @ts-ignore reason.indexedAt unknown
            indexedAt: f.reason.indexedAt,
          };
        }

        if (f.reply) {
          slim.reply = {
            root: {
              // @ts-ignore $type unknown
              $type: f.reply.root.$type,
              // @ts-ignore uri unknown
              uri: f.reply.root.uri,
              author: {
                // @ts-ignore author is unknown
                did: f.reply.root.author?.did,
                // @ts-ignore author is unknown
                handle: f.reply.root.author?.handle,
              },
            },
            parent: {
              // @ts-ignore $type unknown
              $type: f.reply.parent.$type,
              // @ts-ignore uri unknown
              uri: f.reply.parent.uri,
              author: {
                // @ts-ignore author is unknown
                did: f.reply.parent.author?.did,
                // @ts-ignore author is unknown
                handle: f.reply.parent.author?.handle,
              },
            },
          };
        }

        return slim;
      });

      results.push({
        page,
        feedCount: data.feed.length,
        // feed: data.feed,
        feed: slimFeed,
        cursor,
      });

      if (page >= maxPages) {
        this.#debug("Reached the max page limit");
        break;
      }
    } while (cursor);

    return results;
  }

  getRootPosts(): FeedViewPost[] {
    if (!this.feedMap) {
      throw new Error("call populateFeedMap first");
    }

    const rootFeeds = new Set<FeedViewPost>();

    for (const feedView of this.feedMap.values()) {
      const result = this.#getRootAndDepth(feedView.post.uri, 1);
      if (result && result.depth >= this.minDepth) {
        rootFeeds.add(result.rootFeed);
      }
    }

    const sortedFeeds = [...rootFeeds.values()].toSorted((a, b) =>
      b.post.record.createdAt.localeCompare(a.post.record.createdAt)
    );
    return sortedFeeds;
  }

  #getRootAndDepth(
    postURI: string,
    depth: number,
  ): { rootFeed: FeedViewPost; depth: number } | undefined {
    if (!this.feedMap) {
      throw new Error("call populateFeedMap first");
    }

    const feed = this.feedMap.get(postURI);

    if (!feed) {
      this.#debug(
        `Post ${postURI} not found - deleted? too old to be retrieved?`,
      );
      return undefined;
    }

    // We found the root of a thread
    if (!feed.reply) {
      return { rootFeed: feed, depth };
    }

    // ignore this post that's a reply to someone else
    if (feed.reply.parent.author?.did !== this.authorDID) {
      return undefined;
    }

    return this.#getRootAndDepth(feed.reply.parent.uri, depth + 1);
  }

  // use console.error to send diagnostic messages to stderr, so they don't end up in output files
  #debug(msg: string) {
    console.error(msg);
  }
}
