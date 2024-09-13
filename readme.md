# @aleclarson/watchlist

A fork of [watchlist](https://github.com/lukeed/watchlist) with the following changes:

- Stream the command output as it happens
- Fixed: If a file is changed during the command, execute the command again immediately after completion
- More reliable debouncing via `setTimeout`
- Avoid crashing the process when the command fails
- Removed the `run` function from `./src/index.js`
