
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken');
require('dotenv').config()
const app = express()
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000

//middleware
app.use(cors())
app.use(express.json())


//JWT Token verify
const verifyJWT = (req, res, next) =>{
  const authorization = req.headers.authorization
  if(!authorization){
    return res.status(401).send({error: true, message: 'unauthorized access'})
  }
  //bearer token
  const token = authorization.split(' ')[1]

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) =>{
    if(err){
      return res.status(401).send({ error: true, message: 'unauthorized access'})
    }
    req.decoded = decoded 
    next()
  })
}


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wp3p5wr.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const menuCollection = client.db("bistroDb").collection("menu");
    const reviewCollection = client.db("bistroDb").collection("reviews");
    const cartCollection = client.db("bistroDb").collection("carts");
    const usersCollection = client.db("bistroDb").collection("users");
    const paymentCollection = client.db("bistroDb").collection("payments");

    app.post('/jwt', (req, res) =>{
      const user = req.body 
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })

      res.send({ token })
    })

    //WARNING: use verifyJWT before using verifyAdmin
    const verifyAdmin = async(req, res, next) =>{
      email = req.decoded.email 
      const query = {email: email}
      const user = await usersCollection.findOne(query)
      if(user?.role !== 'admin'){
        return res.status(403).send({error: true, message: 'forbidden message'})
      }
      next();
    }

    

    /**
     * 0. Do not show secure links to those who should not see the links.
     * 1. use jwt token: verifyJWT
     * 2. Use verifyAdmin middleware.
     */

    //users related apis
    app.get('/users', verifyJWT, verifyAdmin, async(req, res) =>{
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

    app.post('/users', async (req, res) =>{
      const user = req.body 
      console.log(user)
      const query = {email: user.email}
      const existingUser = await usersCollection.findOne(query)
      console.log('existing user', existingUser)
      if(existingUser){
        return res.send({message: 'user already exists!'})
      }
      const result = await usersCollection.insertOne(user)
      res.send(result)
    })

    //check user admin or not?
    //security layer: 1.verifyJWT,  2.email same,  3.check admin
    app.get('/users/admin/:email', verifyJWT, async(req, res) =>{
      const email = req.params.email 

      if(req.decoded.email !== email){
        res.send({admin: false})
      }

      const query = {email: email}
      const user = await usersCollection.findOne(query)
      const result = {admin: user?.role === 'admin'}
      res.send(result)

    })

    //make admin
    app.patch('/users/admin/:id', async(req, res) =>{
      const id = req.params.id 
      const filter = {_id: new ObjectId(id)}
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc)
      res.send(result)
    })

    //menu related apis
    app.get("/menu", async(req, res) =>{
      const result = await menuCollection.find().toArray()
      res.send(result)
    })

    app.post('/menu', verifyJWT, verifyAdmin, async(req, res) =>{
      const newItem = req.body 
      const result = await menuCollection.insertOne(newItem)
      res.send(result)
    })

    app.delete('/menu/:id', verifyJWT, verifyAdmin, async(req, res) =>{
      const id = req.params.id 
      const query = {_id: new ObjectId(id)}
      const result = await menuCollection.deleteOne(query) 
      res.send(result)
    })

    //reviews related apis
    app.get("/reviews", async(req, res) =>{
      const result = await reviewCollection.find().toArray()
      res.send(result)
    })

    //cart collection api's
    app.get("/carts", verifyJWT, async(req, res) =>{
      const email = req.query.email 
      if(!email){
        res.send([])
      }

      //check user email and token email 
      const decodedEmail = req.decoded.email 
      if(email !== decodedEmail){
        return res.status(403).send({error: true, message: "forbidden access"})
      }

      const query = { email: email };
      const result = await cartCollection.find(query).toArray()
      res.send(result)
    })

    app.post('/carts', async(req, res) =>{
      const item = req.body
      console.log(item)
      const result = await cartCollection.insertOne(item)
      res.send(result)
    })

    app.delete("/carts/:id", async(req, res) =>{
      const id = req.params.id 
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query)
      res.send(result)
    })

    //create payment intent
    app.post('/create-payment-intent', verifyJWT, async(req, res) =>{
      const {price} = req.body
      const amount = parseInt(price*100) 
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      })
      
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })


    //payment related apis
    app.post('/payments', verifyJWT, async(req, res) =>{
      const payment = req.body 
      const insertResult = await paymentCollection.insertOne(payment)

      const query = {_id: {$in: payment.cartItems.map(id => new ObjectId(id))}}
      const deleteResult = await cartCollection.deleteMany(query)

      res.send({insertResult, deleteResult})
    })


    //Admin Home
    app.get('/admin-stats', verifyJWT, verifyAdmin, async(req, res) =>{
      const users = await usersCollection.estimatedDocumentCount()
      const products = await menuCollection.estimatedDocumentCount()
      const orders = await paymentCollection.estimatedDocumentCount()

      //best way to get sum if the price filed is the use group and sum operator
      /*
         await paymentCollection.aggregate([
            {
              $group: {
                _id: null,
                totalPrice: {
                  $sum: '$price'
                }
              }
            }
          ]).toArray()
       */

      const payments = await paymentCollection.find().toArray()
      const revenue = payments.reduce((sum, payment) => sum + payment.price, 0)

      res.send( {users, products, orders, revenue} )
    })


    /**
     * // For Admin Home Re-Chart 
     * ------------------------
     *       BANGLA SYSYTEM
     * ------------------------
     * 1. load all payments.
     * 2. for each payment, get the menuItems array.
     * 3. for each item in the menuItems array get the menuItem from the menu collection.
     * 4. put them in an array: allOrderedItems.
     * 5. separate allOrderedItems by category using filter.
     * 6. now get the quantity by using length: pizzas.length.
     * 7. for each category use reduce to get the total amount spent on the category.
     */
    app.get('/order-stats', verifyJWT, verifyAdmin, async (req, res) => {
      const pipeline = [
        {
          $lookup: {
            from: 'menu',
            localField: 'menuItems',
            foreignField: '_id',
            as: 'menuItemsData'
          }
        },
        {
          $unwind: '$menuItemsData',
        },
        {
          $group: {
            _id: '$menuItemsData.category',
            count: { $sum: 1 },
            totalPrice: { $sum: '$menuItemsData.price' }
          }
        },
        {
          $project: {
            category: '$_id',
            count: 1,
            total: { $round: ['$totalPrice', 2] },
            _id: 0
          }
        }
      ];
    
      const result = await paymentCollection.aggregate(pipeline).toArray();
      res.send(result);
    });
    


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Bistro Boss is running')
})

app.listen(port, () => {
  console.log(`Bistro Boss is running on port ${port}`)
})


/**
 * -----------------------------
 *       NAMING CONVENTION
 * -----------------------------
 * users : usersCollection
 * app.get('/users')
 * app.get('/users/:id')
 * app.post('/users')
 * app.patch('/users/:id')
 * app.put('/users/:id')
 * app.delete('/users/:id')
 */