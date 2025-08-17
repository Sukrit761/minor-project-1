const express=require('express');
const app=express();
const userModel=require("./models/user");
const postModel=require("./models/post");
const cookieParser=require('cookie-parser');
const bcrypt=require('bcrypt');
const jwt=require("jsonwebtoken");
const multer = require('multer');
const path = require('path');

const mongoose = require('mongoose');
mongoose.connect("mongodb://127.0.0.1:27017/mini")
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.log(err));

app.set("view engine","ejs");
app.set(express.json());
app.use(express.urlencoded({extended:true}));
app.use(cookieParser());

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads');  // Create this folder
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });
app.get('/',(req,res)=>{
    res.render("index");
});
app.get('/login', (req,res)=>{
    res.render("login");
});

app.post('/register', async (req, res) => {
    let { email, password, username, name, age } = req.body;
    let user = await userModel.findOne({ email });

    if (user) return res.status(500).send("User already exists");

    bcrypt.genSalt(10, (err, salt) => {
        bcrypt.hash(password, salt, async (err, hash) => {
            let user = await userModel.create({
                username,
                email,
                age,
                name,
                password: hash
            });

            let token = jwt.sign({ email: email, userid: user._id }, "oenfewewee");
            res.cookie("token", token);
            res.redirect("/profile");  // 🔴 Redirect to profile after registration
        });
    });
});


app.get('/profile', isLoggedIN, async (req, res) => {
    let user = await userModel.findOne({ email: req.user.email })
        .populate({
            path: 'posts',
            populate: { path: 'user' }, // If you need user info inside posts
            options: { sort: { createdAt: -1 } }
        });

    if (!user) return res.status(404).send("User not found");

    res.render('profile', { user });
});


app.get("/feed", isLoggedIN, async (req, res) => {
    try {
        const posts = await postModel.find()
            .populate("user")
            .populate({
                path: "comments.user",
                select: "username"
            })
            .lean();

        // 🔍 DEBUG: Log to see what you're getting
        console.log("Total posts found:", posts.length);
        console.log("Posts data:", posts.map(p => ({
            id: p._id,
            content: p.content.substring(0, 50),
            username: p.user?.username
        })));

        res.render("feed", { posts, user: req.user });
    } catch (error) {
        console.log(error);
        res.status(500).send("Something went wrong");
    }
});




app.post('/like/:id', isLoggedIN, async (req, res) => {
    try {
        const post = await postModel.findById(req.params.id);
        if (!post) return res.status(404).send("Post not found");

        const userId = req.user.userid;

        // Only allow like, no unlike
        if (!post.likes.includes(userId)) {
            post.likes.push(userId);
            await post.save();
        }

        res.redirect(req.get('referer'));
    } catch (error) {
        console.log(error);
        res.status(500).send("Something went wrong");
    }
});


app.post('/feed/comment/:id', isLoggedIN, async (req, res) => {
    try {
        const post = await postModel.findById(req.params.id);
        if (!post) return res.status(404).send("Post not found");

        post.comments.push({
            user: req.user.userid,
            content: req.body.comment
        });

        await post.save();
        res.redirect("/feed");
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to add comment");
    }
});

app.post("/comment/delete/:id", isLoggedIN, async (req, res) => {
    try {
        await postModel.updateOne(
            { "comments._id": req.params.id },
            { $pull: { comments: { _id: req.params.id } } }
        );
        res.redirect("/feed");
    } catch (error) {
        console.error(error);
        res.status(500).send("Failed to delete comment.");
    }
});
app.get("/comment/edit/:id", isLoggedIN, async (req, res) => {
    const post = await postModel.findOne({ "comments._id": req.params.id });
    if (!post) return res.status(404).send("Post not found.");

    const comment = post.comments.id(req.params.id);
    if (!comment) return res.status(404).send("Comment not found.");

    // Only allow comment owner to edit
    if (comment.user.toString() !== req.user.userid.toString()) {
        return res.status(403).send("Unauthorized");
    }

    res.render("editComment", { comment });
});

app.post("/comment/edit/:id", isLoggedIN, async (req, res) => {
    const post = await postModel.findOne({ "comments._id": req.params.id });
    if (!post) return res.status(404).send("Post not found.");

    const comment = post.comments.id(req.params.id);
    if (!comment) return res.status(404).send("Comment not found.");

    if (comment.user.toString() !== req.user.userid.toString()) {
        return res.status(403).send("Unauthorized");
    }

    comment.content = req.body.content;
    await post.save();
    res.redirect("/feed");
});





app.get("/edit/:id", isLoggedIN, async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post) return res.status(404).send("Post not found");
  res.render("edit", { post });
});

app.post("/update/:id", isLoggedIN, async (req, res) => {
  try {
    await postModel.findByIdAndUpdate(req.params.id, {
      content: req.body.content,
    });
    res.redirect("/profile");
  } catch (err) {
    console.error("Error updating post:", err);
    res.status(500).send("Update failed");
  }
});

app.post("/delete/:id", isLoggedIN, async (req, res) => {
  try {
    const post = await postModel.findById(req.params.id);

    if (!post) {
      return res.status(404).send("Post not found.");
    }

    // Check if the logged-in user is the post's owner
    if (post.user.toString() !== req.user.userid.toString()) {
      return res.status(403).send("Unauthorized to delete this post.");
    }

    await postModel.findByIdAndDelete(req.params.id);

    // Also remove from user's post array
    await userModel.findByIdAndUpdate(req.user.userid, {
      $pull: { posts: req.params.id }
    });

    res.redirect("/profile");
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).send("Something went wrong");
  }
});

app.post('/feed/delete/:id', isLoggedIN, async (req, res) => {
    try {
        const post = await postModel.findById(req.params.id);

        if (!post) {
            return res.status(404).send("Post not found.");
        }

        // Allow only post owner to delete
        if (post.user.toString() !== req.user.userid.toString()) {
            return res.status(403).send("Unauthorized to delete this post.");
        }

        await postModel.findByIdAndDelete(req.params.id);

        // Remove post from user's posts array
        await userModel.findByIdAndUpdate(req.user.userid, {
            $pull: { posts: req.params.id }
        });

        res.redirect("/feed");
    } catch (err) {
        console.error("Delete error:", err);
        res.status(500).send("Something went wrong");
    }
});




app.post('/post', isLoggedIN, upload.single('photo'), async (req, res) => {
    try {
        const { content } = req.body;
        const photo = req.file ? `/uploads/${req.file.filename}` : null;

        const post = await postModel.create({
            user: req.user.userid,
            content,
            photo
        });

        await userModel.findByIdAndUpdate(req.user.userid, {
            $push: { posts: post._id }
        });

        res.redirect('/profile');
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to create post.");
    }
});


app.get('/all-posts', async (req, res) => {
    const posts = await postModel.find().populate("user");
    res.json(posts);
});


app.post('/login', async (req, res) => {
    let { email, password } = req.body;
    let user = await userModel.findOne({ email });

    if (!user) return res.status(400).send("User not found");

    bcrypt.compare(password, user.password, function (err, result) {
        if (result) {
            let token = jwt.sign({ email: email, userid: user._id }, "oenfewewee");
            res.cookie("token", token);
            return res.redirect("/feed");  // ✅ Go to feed, not profile
        } else {
            return res.status(401).redirect("/login"); // Wrong password
        }
    });
});


app.get('/logout',(req,res)=>{
    res.cookie("token","");
    res.redirect("/login");
});

function isLoggedIN(req, res, next) {
  const token = req.cookies.token;


  if (!token) return res.redirect("/login");

  try {
    const data = jwt.verify(token, "oenfewewee");
    req.user = data; // Attach decoded token to req.user
    next(); // Proceed to next middleware or route
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.redirect("/login");
  }
}



app.listen(3000);
