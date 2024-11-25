let cmd = `--format-options '{"snippetInterface": "synchronous"}'`;

if (process.env.TAGS) {
    // @see https://cucumber.io/docs/cucumber/api/?lang=javascript#tags
    cmd += ` --tags '${process.env.TAGS}'`;
}

console.log(cmd);

export default cmd;
