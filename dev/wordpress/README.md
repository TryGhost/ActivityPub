# WordPress ActivityPub

Start a new WordPress instance on a dedicated domain with ActivityPub enabled

This is useful for testing interoperability between Ghost ActivityPub and
WordPress ActivityPub

Data is ephemeral and will be lost when the script is stopped

## Prerequisites

- Ensure you have `cloudflared` installed
- Ensure you have the main project containers running (`yarn dev`)

## Usage

From the root of the project, run:

```bash
./dev/wordpress/start.sh
```