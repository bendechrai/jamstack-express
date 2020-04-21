import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import faunadb, { query as q } from "faunadb"

import jwt from 'express-jwt'
import jwtAuthz from 'express-jwt-authz'
import jwksRsa from 'jwks-rsa'

if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
    throw 'Make sure you have AUTH0_DOMAIN, and AUTH0_AUDIENCE in your .env file';
}

const checkJwt = jwt({
    // Dynamically provide a signing key based on the [Key ID](https://tools.ietf.org/html/rfc7515#section-4.1.4) header parameter ("kid") and the signing keys provided by the JWKS endpoint.
    secret: jwksRsa.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
    }),

    // Validate the audience and the issuer.
    audience: process.env.AUTH0_AUDIENCE,
    issuer: `https://${process.env.AUTH0_DOMAIN}/`,
    algorithms: ['RS256']
});

const checkCanDelete = jwtAuthz(['delete:comment']);

const app = express()
app.use(cors())
app.use(express.json());

app.get('/comments/:postId', async (req, res) => {

    const { FAUNADB_SECRET: faunadb_secret } = process.env
    const client = new faunadb.Client({ secret: faunadb_secret })
    const postId = req.params.postId

    const commentsCollection = await client
        .query(q.Paginate(q.Match(q.Ref("indexes/comments"), postId)))
        .then(response => {
            const commentRefs = response.data
            const getCommentDataQuery = commentRefs.map(ref => {
                return q.Get(ref)
            })
            return client.query(getCommentDataQuery)
        })
        .catch(error => res.send("Not found"))

    const comments = commentsCollection.map(item => {
        item.data.id = item.ref.id
        return item.data
    })
    res.json(comments)
    res.end()

})

app.post('/comments/:postId', async (req, res) => {

    const { FAUNADB_SECRET: faunadb_secret } = process.env
    const client = new faunadb.Client({ secret: faunadb_secret })
    const postId = req.params.postId
    const comment = req.body.comment || ''
    const author = req.body.author || ''

    if (comment === "" || author === "") {
        res.status(400)
        res.json({ message: "Both comment and author are required" })
        res.end()

    } else {

        await client.query(
            q.Create(q.Collection("comments"), {
                data: {
                    postId: postId,
                    comment: comment,
                    author: author
                }
            })
        );

        res.status(201)
        res.json({ message: "Comment added" })
        res.end()

    }

})

app.delete('/comments/:postId/:commentId', checkJwt, checkCanDelete, async (req, res) => {

    const { FAUNADB_SECRET: faunadb_secret } = process.env
    const client = new faunadb.Client({ secret: faunadb_secret })
    const postId = req.params.postId
    const commentId = req.params.commentId

    // Load the comment
    const comment = await client.query(q.Get(q.Ref(q.Collection('comments'), commentId)))
        .catch(err => {
            res.status(404)
            res.json({ message: "Comment not found" })
            res.end()
        })

    // If it's for the specified post, delete it
    if (comment.data.postId == postId) {
        await client.query(q.Delete(comment.ref))
        res.status(204)
        res.end()

    } else {
        res.status(404)
        res.json({ message: "Comment not doesn't belong to this post" })
        res.end()

    }

})

app.listen(process.env.PORT, () =>
    console.log(`Example app listening on port ${process.env.PORT}!`)
)
